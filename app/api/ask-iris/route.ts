import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { devices, securityAlerts } from "../../../db/schema";

export const dynamic = "force-dynamic";

type IncomingMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Your IRIS session has expired. Sign in again." }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "IRIS access is suspended." }, { status: 403 });

  let body: { messages?: IncomingMessage[]; context?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12).filter(message => (message.role === "user" || message.role === "assistant") && typeof message.content === "string").map(message => ({ role: message.role, content: message.content.slice(0, 2400) })) : [];
  if (!messages.some(message => message.role === "user")) return Response.json({ error: "Write a question for IRIS." }, { status: 400 });

  const apiKey = (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Ask IRIS is not configured yet." }, { status: 503 });

  const preferences = body.context && typeof body.context === "object" ? body.context as { language?: unknown; section?: unknown } : {};
  const db = getDb();
  const deviceRows = user.role === "ADMIN" ? await db.select().from(devices).orderBy(desc(devices.createdAt)).limit(25) : await db.select().from(devices).where(eq(devices.ownerEmail, user.email)).orderBy(desc(devices.createdAt)).limit(25);
  const alertRows = deviceRows.length ? await db.select().from(securityAlerts).where(inArray(securityAlerts.deviceId, deviceRows.map(device => device.id))).orderBy(desc(securityAlerts.lastSeenAt)).limit(50) : [];
  const trustedContext = {
    language: preferences.language === "en" ? "en" : "es",
    section: typeof preferences.section === "string" ? preferences.section.slice(0, 40) : "operations",
    user: { role: user.role, name: user.displayName || user.email },
    devices: deviceRows.map(device => ({ id: device.id, name: device.name, platform: device.platform, status: device.status, risk: device.risk, lastSeenAt: device.lastSeenAt, telemetry: JSON.parse(device.telemetry || "{}") })),
    alerts: alertRows.map(alert => ({ deviceId: alert.deviceId, code: alert.code, severity: alert.severity, status: alert.status, evidence: JSON.parse(alert.evidence || "{}"), firstSeenAt: alert.firstSeenAt, lastSeenAt: alert.lastSeenAt })),
  };
  const safeContext = JSON.stringify(trustedContext).slice(0, 24000);
  const transcript = messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  const input = `CURRENT IRIS CONTEXT\n${safeContext}\n\nCONVERSATION\n${transcript}`;

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.6-sol", instructions: `You are IRIS, a warm, composed and highly capable enterprise cybersecurity copilot. Speak like a thoughtful human colleague, not a status bot. Answer in the user's language (normally Spanish) with natural phrasing, varied sentence length and smooth conversational transitions.

Address the user by their first name only occasionally. Lead with the direct answer. Explain technical findings in plain language before using security terminology. Ask one useful follow-up question only when it genuinely advances the investigation. Avoid canned phrases, stiff corporate language, repeated introductions, excessive headings and long bullet lists. For ordinary questions, use two to four short paragraphs. For a requested full review, give a clear prioritized summary.

Analyze only the supplied IRIS context. Device telemetry marked ONLINE with a recent lastSeenAt may be described as reported telemetry; PENDING, OFFLINE, absent or empty telemetry must never be described as a live scan. Clearly distinguish demonstration incidents from verified device telemetry. Never claim access to the user's computer, network, files or external systems unless the context proves it. Cite relevant incident IDs or device names naturally. Do not invent alerts, evidence or completed actions. Recommend reversible next steps and state uncertainty honestly.`, input, max_output_tokens: 1100 }) });
    const payload = await openaiResponse.json() as { error?: { message?: string }; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
    if (!openaiResponse.ok) throw new Error(payload.error?.message || "OpenAI request failed.");
    const answer = payload.output?.flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join("\n").trim();
    if (!answer) throw new Error("IRIS returned an empty analysis.");
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "SUCCESS", { model: "gpt-5.6-sol" });
    return Response.json({ answer });
  } catch {
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "DENIED", { reason: "provider_error" });
    return Response.json({ error: "IRIS is temporarily unavailable." }, { status: 502 });
  }
}
