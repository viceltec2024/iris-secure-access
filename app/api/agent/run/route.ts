import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../../lib/authz";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { IRIS_AGENT_TOOLS, runIrisTool, type IrisAgentStep } from "../../../../lib/iris-agent";
import { parseAskIncident, resolveIrisAsk } from "../../../../lib/iris-ask";

export const dynamic = "force-dynamic";

type IncomingMessage = { role: "user" | "assistant"; content: string };
type ToolCall = { type?: string; name?: string; arguments?: string; call_id?: string };
type ModelOutput = { type?: string; content?: Array<{ type?: string; text?: string }>; name?: string; arguments?: string; call_id?: string };

const MAX_STEPS = 7;

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

  const apiKey = (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  if (!apiKey) {
    const local = await resolveIrisAsk({
      user: { email: user.email, role: user.role, displayName: user.displayName || user.email },
      messages,
      language,
      section: typeof preferences.section === "string" ? preferences.section.slice(0, 40) : "operations",
      incident: parseAskIncident(preferences.incident),
      origin: new URL(request.url).origin,
    });
    await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "SUCCESS", { model: local.model, fallback: "local" });
    return Response.json({ answer: local.answer, source: local.source, steps: [] as IrisAgentStep[] });
  }

  const input: Array<Record<string, unknown>> = messages.map(message => ({ role: message.role, content: message.content }));
  const steps: IrisAgentStep[] = [];

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const ai = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          instructions: `You are IRIS, a warm and capable cybersecurity colleague in a live SOC chat.
Speak naturally in ${language === "en" ? "English" : "Spanish"}: short paragraphs, varied rhythm, no stiff corporate filler, no repeated intros.

Voice is already handled by the IRIS app. Every user message is text from typing OR from speech-to-text. You ARE listening through that pipeline. Never say you lack a microphone, cannot hear audio, only read chat, or cannot listen. Never apologize for missing audio access.

If a user message looks like speech noise or is unclear, ask them to repeat the question briefly. Do not invent topics (for example do not invent an item named S8 unless tools return it).

You can investigate with tools and, when the user clearly confirms in chat, take safe actions.
Investigation tools: get_security_overview, list_active_alerts, get_device_details, explain_alert.
Action tools (require userConfirmed=true ONLY after an explicit user yes/confirm): trust_application, update_alert_status, approve_remediation, request_device_recheck.

Rules:
- Lead with the direct answer, then a brief why, then one concrete next step when useful.
- Never claim an action happened unless a tool result proves it.
- Never set userConfirmed=true unless the user clearly authorized that specific action.
- Never invent device or alert data. Never run destructive actions (delete files, disable SIP/FileVault, kill processes, spend crypto).
- ONLINE means the Mac agent reported in the last 5 minutes. PENDING/OFFLINE telemetry is not a live scan.
- Prefer tools for SOC questions instead of guessing.`,
          input,
          tools: IRIS_AGENT_TOOLS,
          max_output_tokens: 1400,
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

      input.push(...(payload.output || []));
      for (const call of calls) {
        if (!call.name || !call.call_id) continue;
        try {
          const result = await runIrisTool({ email: user.email, role: user.role as "ADMIN" | "USER" }, call.name, call.arguments || "{}");
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
    const local = await resolveIrisAsk({
      user: { email: user.email, role: user.role, displayName: user.displayName || user.email },
      messages,
      language,
      section: typeof preferences.section === "string" ? preferences.section.slice(0, 40) : "operations",
      incident: parseAskIncident(preferences.incident),
      origin: new URL(request.url).origin,
    }).catch(() => null);
    if (local?.answer) {
      await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "SUCCESS", { model: local.model, fallback: true });
      return Response.json({ answer: local.answer, source: local.source, steps });
    }
    await logAudit(user.email, "IRIS_AGENT_RUN", "agent", "DENIED", { reason: "provider_error" });
    return Response.json({ error: language === "es" ? "IRIS no está disponible temporalmente." : "IRIS Agent is temporarily unavailable." }, { status: 502 });
  }
}
