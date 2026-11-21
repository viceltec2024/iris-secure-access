import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../../lib/authz";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { IRIS_AGENT_TOOLS, runIrisTool, type IrisAgentStep } from "../../../../lib/iris-agent";
import { parseAskIncident, resolveIrisAsk } from "../../../../lib/iris-ask";
import { buildSocReasonedAnswerForAsk } from "../../../../lib/iris-ask-reasoning";
import { buildIrisAgentInstructions, MAX_AGENT_TOOL_CALLS, withinAgentToolLimit } from "../../../../lib/iris-agent-workflow";
import { internalEvidenceRef } from "../../../../lib/iris-soc-reasoning";
import { detectPromptInjection } from "../../../../lib/iris-guardian";
import { isEditAssistRequest, localMuseEditFallback, museApiKey, runMuseEditAgent } from "../../../../lib/iris-muse";
import { routeIrisTextRequest } from "../../../../lib/iris-model-router";

export const dynamic = "force-dynamic";

type IncomingMessage = { role: "user" | "assistant"; content: string };
type ToolCall = { type?: string; name?: string; arguments?: string; call_id?: string };
type ModelOutput = { type?: string; content?: Array<{ type?: string; text?: string }>; name?: string; arguments?: string; call_id?: string };

const MAX_STEPS = 5;

function responseText(payload: { output?: ModelOutput[] }) {
  return (payload.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text || "")
    .join("\n")
    .trim();
}

function toolCalls(payload: { output?: ModelOutput[] }): ToolCall[] {
  return (payload.output || []).filter(item => item.type === "function_call");
}

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Your IRIS session has expired. Sign in again." }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "IRIS access is suspended." }, { status: 403 });

  if (!(await enforceRateLimit(`iris-agent:${user.email}`, 12, 60 * 1000))) {
    await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiadas consultas. Espera un momento." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let body: { messages?: IncomingMessage[]; language?: unknown; context?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }

  const preferences = body.context && typeof body.context === "object" ? body.context as { language?: unknown; section?: unknown; incident?: unknown } : {};
  const language = body.language === "en" || preferences.language === "en" ? "en" : "es";
  const messages = Array.isArray(body.messages)
    ? body.messages.slice(-12).filter(message => (message.role === "user" || message.role === "assistant") && typeof message.content === "string").map(message => ({ role: message.role, content: message.content.slice(0, 3000) }))
    : [];
  if (!messages.some(message => message.role === "user")) return Response.json({ error: language === "es" ? "Escribe una pregunta para IRIS." : "Write a request for IRIS." }, { status: 400 });

  const bindings = env as unknown as Record<string, string | undefined>;
  const lastUser = [...messages].reverse().find(message => message.role === "user")?.content || "";
  const guardian = detectPromptInjection(lastUser, language);
  if (guardian.blocked) {
    await logAudit(user.email, "IRIS_AGENT_GUARDIAN_BLOCKED", "agent", "DENIED", { code: guardian.code });
    return Response.json({
      error: guardian.message,
      answer: guardian.message,
      source: "guardian",
      blocked: true,
      code: guardian.code,
      steps: [{ tool: "guardian", arguments: { code: guardian.code }, ok: false }],
    }, { status: 400 });
  }
  const route = routeIrisTextRequest({ question: lastUser, env: bindings });
  const wantsEdit = route.kind === "edit" || isEditAssistRequest(lastUser);
  const museKey = museApiKey(bindings);
  if (wantsEdit && museKey) {
    try {
      const incident = parseAskIncident(preferences.incident);
      const contextNote = incident
        ? `Incidente seleccionado: ${incident.id} · ${incident.title} · ${incident.subject}\nRecomendación actual: ${incident.recommendation}\nEvidencia: ${incident.evidence.join(" | ")}`
        : "";
      const muse = await runMuseEditAgent({
        apiKey: museKey,
        messages,
        language,
        contextNote,
      });
      const steps: IrisAgentStep[] = [{ tool: "muse_edit", arguments: { model: muse.model }, ok: true }];
      await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "SUCCESS", { model: muse.model, source: "muse" });
      return Response.json({ answer: muse.answer, source: muse.source, steps });
    } catch {
      const answer = localMuseEditFallback(lastUser, language);
      const steps: IrisAgentStep[] = [{ tool: "muse_edit", arguments: { fallback: "local" }, ok: false }];
      await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "SUCCESS", { model: "muse-local-fallback", source: "muse-local" });
      return Response.json({ answer, source: "muse-local", steps });
    }
  }
  if (wantsEdit) {
    const answer = localMuseEditFallback(lastUser, language);
    const steps: IrisAgentStep[] = [{ tool: "muse_edit", arguments: { fallback: "local" }, ok: true }];
    await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "SUCCESS", { model: "muse-local-fallback", source: "muse-local" });
    return Response.json({ answer, source: "muse-local", steps });
  }

  async function localResponse(fallback = false) {
    const local = await resolveIrisAsk({
      user: { email: user.email, role: user.role, displayName: user.displayName || user.email },
      messages,
      language,
      section: typeof preferences.section === "string" ? preferences.section.slice(0, 40) : "operations",
      incident: parseAskIncident(preferences.incident),
      origin: new URL(request.url).origin,
    });

    if (local.memoryConsent && local.memoryConsent.suppressedCount > 0) {
      await logAudit(user.email, "ASK_IRIS_MEMORY_CONSENT", "memory", "DENIED", {
        reason: "no_consent",
        suppressed: local.memoryConsent.suppressedCount,
        consentedCategories: local.memoryConsent.consentedCategories.join(","),
      });
    }

    if (local.source === "local" && local.context) {
      const soc = buildSocReasonedAnswerForAsk({
        question: lastUser,
        language,
        context: local.context,
      });
      if (soc) {
        await logAudit(user.email, "IRIS_AGENT_RUN", "reasoned_soc", "SUCCESS", {
          model: local.model,
          confidence: soc.confidence,
          evidence: soc.evidence.length,
          droppedMemory: soc.droppedMemory.length,
        });
        return {
          answer: soc.answer,
          source: "reasoned_soc",
          confidence: soc.confidence,
          evidence: soc.evidence.map(item => ({ ref: internalEvidenceRef(item), title: item.title, sourceLabel: item.sourceLabel })),
          steps: [] as IrisAgentStep[],
        };
      }
    }

    await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "SUCCESS", fallback
      ? { model: local.model, fallback: true }
      : { model: local.model, fallback: "local", source: local.source });
    return { answer: local.answer, source: local.source, steps: [] as IrisAgentStep[] };
  }

  const apiKey = bindings.OPENAI_API_KEY;
  if (!apiKey || route.kind !== "agent") {
    const local = await localResponse();
    const steps: IrisAgentStep[] = local.source === "world"
      ? [{ tool: "lookup_wikipedia", arguments: { source: "wikipedia" }, ok: true }]
      : local.steps;
    return Response.json({ ...local, steps });
  }

  const input: Array<Record<string, unknown>> = messages.map(message => ({ role: message.role, content: message.content }));
  const steps: IrisAgentStep[] = [];
  let toolCallsExecuted = 0;

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const ai = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          instructions: buildIrisAgentInstructions(language),
          input,
          tools: IRIS_AGENT_TOOLS,
          max_output_tokens: 1200,
        }),
      });
      const payload = await ai.json() as { error?: { message?: string }; output?: ModelOutput[] };
      if (!ai.ok) throw new Error(payload.error?.message || "OpenAI request failed");

      const calls = toolCalls(payload);
      const answer = responseText(payload);
      if (!calls.length) {
        await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "SUCCESS", { steps: steps.length });
        return Response.json({ answer: answer || (language === "es" ? "IRIS terminó el análisis." : "IRIS completed the analysis."), source: "agent", steps });
      }

      const modelStream = detectPromptInjection(JSON.stringify(payload.output || []).slice(0, 8000), language);
      if (modelStream.blocked) {
        await logAudit(user.email, "IRIS_AGENT_GUARDIAN_BLOCKED", "agent", "DENIED", { code: modelStream.code, phase: "model_output" });
        return Response.json({
          error: modelStream.message,
          answer: modelStream.message,
          source: "guardian",
          blocked: true,
          code: modelStream.code,
          steps,
        }, { status: 400 });
      }

      input.push(...(payload.output || []));
      for (const call of calls) {
        if (!call.name || !call.call_id) continue;
        if (!withinAgentToolLimit(toolCallsExecuted)) {
          steps.push({ tool: call.name, arguments: { rejected: "tool_call_limit" }, ok: false });
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify({ error: `Safe tool-call limit (${MAX_AGENT_TOOL_CALLS}) reached; do not make further tool calls.` }),
          });
          continue;
        }
        toolCallsExecuted += 1;
        const argGuard = detectPromptInjection(String(call.arguments || ""), language);
        if (argGuard.blocked) {
          steps.push({ tool: call.name, arguments: { blocked: argGuard.code }, ok: false });
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify({ error: argGuard.message, blocked: true, code: argGuard.code }),
          });
          await logAudit(user.email, "IRIS_AGENT_GUARDIAN_BLOCKED", "agent", "DENIED", { code: argGuard.code, phase: "tool_args", tool: call.name });
          continue;
        }
        try {
          const result = await runIrisTool({ email: user.email, role: user.role as "ADMIN" | "USER" }, call.name, call.arguments || "{}");
          const resultGuard = detectPromptInjection(JSON.stringify(result).slice(0, 8000), language);
          if (resultGuard.blocked) {
            steps.push({ tool: call.name, arguments: { blocked: resultGuard.code }, ok: false });
            input.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: JSON.stringify({ error: resultGuard.message, blocked: true, code: resultGuard.code }),
            });
            await logAudit(user.email, "IRIS_AGENT_GUARDIAN_BLOCKED", "agent", "DENIED", { code: resultGuard.code, phase: "tool_result", tool: call.name });
            continue;
          }
          let parsed: Record<string, unknown> = {};
          try { parsed = JSON.parse(call.arguments || "{}") as Record<string, unknown>; } catch { parsed = {}; }
          steps.push({ tool: call.name, arguments: parsed, ok: true });
          input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
        } catch (error) {
          steps.push({ tool: call.name, arguments: {}, ok: false });
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed" }),
          });
        }
      }
    }

    await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "DENIED", { reason: "step_limit" });
    return Response.json({ error: language === "es" ? "IRIS llegó al límite seguro de pasos." : "IRIS reached the safe execution-step limit.", steps }, { status: 409 });
  } catch {
    const local = await localResponse(true).catch(() => null);
    if (local?.answer) {
      return Response.json({ ...local, steps });
    }
    await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "DENIED", { reason: "provider_error" });
    return Response.json({ error: language === "es" ? "IRIS no está disponible temporalmente." : "IRIS Agent is temporarily unavailable." }, { status: 502 });
  }
}
