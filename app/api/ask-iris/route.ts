import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { parseAskIncident, resolveIrisAsk } from "../../../lib/iris-ask";
import { guardConversation } from "../../../lib/iris-guardian";
import { isEditAssistRequest, localMuseEditFallback, museApiKey, runMuseEditAgent } from "../../../lib/iris-muse";
import { recordOrgObs } from "../../../lib/iris-obs-store";
import { requireOrgContext } from "../../../lib/iris-tenant";
import { requireStepUp } from "../../../lib/iris-step-up";
import { afterGuardianBlock, recordAttackSignals, requestIp, requireNotQuarantined, threatSnapshot } from "../../../lib/iris-threats";
import { isThreatQuestion, quarantineBody } from "../../../lib/iris-threats-core";
import { extractNameCommand, nameSavedReply } from "../../../lib/iris-name-core";
import { setPreferredName, userFriendlyName } from "../../../lib/iris-names";

export const dynamic = "force-dynamic";

type IncomingMessage = { role: "user" | "assistant"; content: string };

async function recordAskObs(email: string, kind: "ask_latency_ms" | "guardian_block", value: number, label?: string) {
  try {
    const ctx = await requireOrgContext(email);
    await recordOrgObs({ organizationId: ctx.organization.id, actorEmail: email, kind, value, label });
  } catch {
    // observability is best-effort
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  const identity = await getChatGPTUser();
  if (!identity) {
    return Response.json({
      error: "Tu sesión de IRIS expiró. Vuelve a iniciar sesión.",
    }, { status: 401 });
  }
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") {
    return Response.json({ error: "El acceso a IRIS está suspendido." }, { status: 403 });
  }
  const stepUp = await requireStepUp(user.email);
  if (stepUp) return stepUp;
  const quarantined = await requireNotQuarantined(user.email);
  if (quarantined) return quarantined;

  if (!(await enforceRateLimit(`ask-iris:${user.email}`, 60, 60 * 1000))) {
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiadas consultas. Espera un momento." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let body: { messages?: IncomingMessage[]; context?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Solicitud inválida." }, { status: 400 }); }
  const preferencesEarly = body.context && typeof body.context === "object" ? body.context as { language?: unknown } : {};
  const languageHint = preferencesEarly.language === "en" ? "en" : "es";
  const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-12).filter(message => (message.role === "user" || message.role === "assistant") && typeof message.content === "string").map(message => ({ role: message.role, content: message.content.slice(0, 2400) })) : [];
  if (!rawMessages.some(message => message.role === "user")) {
    return Response.json({
      error: languageHint === "en" ? "Write a question for IRIS." : "Escribe una pregunta para IRIS.",
    }, { status: 400 });
  }

  const preferences = body.context && typeof body.context === "object" ? body.context as { language?: unknown; section?: unknown; incident?: unknown } : {};
  const language = preferences.language === "en" ? "en" : "es";
  // Guardian revisa toda la conversación: el último mensaje del usuario
  // bloquea; los mensajes anteriores marcados se quitan antes del modelo.
  const conversation = guardConversation(rawMessages, language);
  const messages = conversation.messages;
  const guardian = conversation.finding;
  const lastUser = [...messages].reverse().find(message => message.role === "user")?.content || "";
  if (conversation.dropped) await logAudit(user.email, "GUARDIAN_HISTORY_DROPPED", "security_context", "DENIED", { dropped: conversation.dropped });
  if (guardian.blocked) {
    const ip = requestIp(request);
    await logAudit(user.email, "ASK_IRIS_GUARDIAN_BLOCKED", "security_context", "DENIED", { code: guardian.code, ...(ip ? { ip } : {}) });
    await recordAskObs(user.email, "guardian_block", 1, guardian.code);
    // Ataques repetidos → cuarentena temporal y aviso al administrador.
    const quarantine = await afterGuardianBlock(user.email);
    const blockedAnswer = quarantine
      ? `${guardian.message} ${quarantineBody(quarantine, language).error}`
      : guardian.message;
    return Response.json({
      error: blockedAnswer,
      answer: blockedAnswer,
      source: "guardian",
      blocked: true,
      code: guardian.code,
    }, { status: 400 });
  }
  // Sondas de ataque web (SQL, XSS, rutas): no bloquean, pero se rastrean.
  await recordAttackSignals(user.email, lastUser, requestIp(request), language);

  // "Llámame Ana": IRIS guarda cómo quiere el usuario que lo llame.
  const nameCommand = extractNameCommand(lastUser);
  if (nameCommand) {
    const saved = await setPreferredName(user.email, nameCommand).catch(() => null);
    if (saved) {
      await logAudit(user.email, "IRIS_PREFERRED_NAME_SET", "ask_iris", "SUCCESS", {});
      return Response.json({ answer: nameSavedReply(saved, language), source: "local" });
    }
  }
  const userName = await userFriendlyName(user);

  // Preguntas sobre ataques a IRIS: se contestan con el registro real de
  // Guardian, nunca con texto inventado por un modelo.
  // Si el registro no se puede leer, se sigue con el flujo normal: Ask IRIS
  // siempre contesta por escrito.
  const snapshot = isThreatQuestion(lastUser)
    ? await threatSnapshot({ email: user.email, role: user.role, language, userName }).catch(() => null)
    : null;
  if (snapshot) {
    const extra = snapshot.report.recommendations.slice(0, 2).join(" ");
    const answer = `${snapshot.report.spoken}${extra ? ` ${language === "es" ? "Te recomiendo:" : "My recommendation:"} ${extra}` : ""}`;
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "guardian_report", "SUCCESS", { status: snapshot.report.status, threats: snapshot.report.totalThreats });
    await recordAskObs(user.email, "ask_latency_ms", Date.now() - started, "guardian");
    return Response.json({ answer, source: "guardian" });
  }

  const bindings = env as unknown as Record<string, string | undefined>;
  const wantsEdit = isEditAssistRequest(lastUser);
  const museKey = museApiKey(bindings);
  if (wantsEdit && museKey) {
    try {
      const incident = parseAskIncident(preferences.incident);
      const contextNote = incident
        ? `Incidente seleccionado: ${incident.id} · ${incident.title} · ${incident.subject}\nRecomendación actual: ${incident.recommendation}`
        : "";
      const muse = await runMuseEditAgent({ apiKey: museKey, messages, language, contextNote });
      await logAudit(user.email, "ASK_IRIS_ANALYSIS", "muse_edit", "SUCCESS", { model: muse.model });
      return Response.json({ answer: muse.answer, source: muse.source });
    } catch {
      const answer = localMuseEditFallback(lastUser, language);
      await logAudit(user.email, "ASK_IRIS_ANALYSIS", "muse_edit", "SUCCESS", { model: "muse-local-fallback", fallback: true });
      return Response.json({ answer, source: "muse-local" });
    }
  }
  if (wantsEdit) {
    const answer = localMuseEditFallback(lastUser, language);
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "muse_edit", "SUCCESS", { model: "muse-local-fallback" });
    return Response.json({ answer, source: "muse-local" });
  }

  const resolved = await resolveIrisAsk({
    user: { email: user.email, role: user.role, displayName: userName },
    messages,
    language,
    section: typeof preferences.section === "string" ? preferences.section.slice(0, 40) : "operations",
    incident: parseAskIncident(preferences.incident),
    origin: new URL(request.url).origin,
  });

  const apiKey = bindings.OPENAI_API_KEY;
  if (!apiKey || resolved.source === "live-market") {
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", resolved.source === "live-market" ? "live_market" : "security_context", "SUCCESS", { model: resolved.model, ticker: resolved.ticker || "" });
    await recordAskObs(user.email, "ask_latency_ms", Date.now() - started, resolved.source);
    return Response.json({ answer: resolved.answer, source: resolved.source });
  }

  const analystInput = resolved.context;
  if (!analystInput) {
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "SUCCESS", { model: resolved.model });
    await recordAskObs(user.email, "ask_latency_ms", Date.now() - started, resolved.source);
    return Response.json({ answer: resolved.answer, source: resolved.source });
  }

  const safeContext = JSON.stringify({ ...analystInput, question: undefined }).slice(0, 24000);
  const transcript = messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  const input = `CURRENT IRIS CONTEXT\n${safeContext}\n\nCONVERSATION\n${transcript}`;

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.6-sol", instructions: `You are IRIS, a warm, composed and highly capable enterprise cybersecurity copilot. Speak like a thoughtful human colleague, not a status bot. Answer in the user's language (normally Spanish) with natural phrasing, varied sentence length and smooth conversational transitions.

The user's name is ${userName}. Address them by that name only occasionally, never by their email. Lead with the direct answer. Explain technical findings in plain language before using security terminology. Ask one useful follow-up question only when it genuinely advances the investigation. Avoid canned phrases, stiff corporate language, repeated introductions, excessive headings and long bullet lists. For ordinary questions, use two to four short paragraphs. For a requested full review, give a clear prioritized summary.

Analyze only the supplied IRIS context. Device telemetry marked ONLINE with a recent lastSeenAt may be described as reported telemetry; PENDING, OFFLINE, absent or empty telemetry must never be described as a live scan. Clearly distinguish demonstration incidents from verified device telemetry. Never claim access to the user's computer, network, files or external systems unless the context proves it. Cite relevant incident IDs or device names naturally. Do not invent alerts, evidence, file paths, locations or completed actions. Recommend reversible next steps and state uncertainty honestly.

When the user asks by voice for the system status, answer aloud naturally and concisely in this order: device connection and report time, health/risk, protection controls, active verified findings, and recommended next action. For threat location, say the exact file or application path only when a locations or threatLocations field supplies it. Otherwise explain that IRIS knows the affected device or application but does not yet have a verified filesystem path. Never call a user-approved application malware merely because its signature could not be verified.`, input, max_output_tokens: 1100 }) });
    const payload = await openaiResponse.json() as { error?: { message?: string }; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
    if (!openaiResponse.ok) throw new Error(payload.error?.message || "OpenAI request failed.");
    const answer = payload.output?.flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join("\n").trim();
    if (!answer) throw new Error("IRIS returned an empty analysis.");
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "SUCCESS", { model: "gpt-5.6-sol" });
    await recordAskObs(user.email, "ask_latency_ms", Date.now() - started, "openai");
    return Response.json({ answer, source: "openai" });
  } catch {
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "SUCCESS", { model: resolved.model, fallback: true });
    await recordAskObs(user.email, "ask_latency_ms", Date.now() - started, `${resolved.source}_fallback`);
    return Response.json({ answer: resolved.answer, source: resolved.source });
  }
}
