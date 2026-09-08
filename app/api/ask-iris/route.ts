import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, devices, securityAlerts } from "../../../db/schema";
import { parseWalletSessionValue } from "../../../lib/iris-chain";
import { parseJsonRecord, reportedDeviceStatus } from "../../../lib/iris-device-view";
import { liveWorkers } from "../../../lib/iris-live-soc";
import { irisMindAnswer } from "../../../lib/iris-mind";
import { briefingFromBoard, extractTicker, fetchLiveTape, fetchMarketChart, isMarketQuestion, marketAnswer } from "../../../lib/iris-market";
import { parsePurchaseDesk } from "../../../lib/iris-purchases";

export const dynamic = "force-dynamic";

type IncomingMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Your IRIS session has expired. Sign in again." }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "IRIS access is suspended." }, { status: 403 });

  if (!(await enforceRateLimit(`ask-iris:${user.email}`, 60, 60 * 1000))) {
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiadas consultas. Espera un momento." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let body: { messages?: IncomingMessage[]; context?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12).filter(message => (message.role === "user" || message.role === "assistant") && typeof message.content === "string").map(message => ({ role: message.role, content: message.content.slice(0, 2400) })) : [];
  if (!messages.some(message => message.role === "user")) return Response.json({ error: "Write a question for IRIS." }, { status: 400 });

  const preferences = body.context && typeof body.context === "object" ? body.context as { language?: unknown; section?: unknown } : {};
  const language = preferences.language === "en" ? "en" : "es";
  const db = getDb();
  const deviceRows = user.role === "ADMIN" ? await db.select().from(devices).orderBy(desc(devices.createdAt)).limit(25) : await db.select().from(devices).where(eq(devices.ownerEmail, user.email)).orderBy(desc(devices.createdAt)).limit(25);
  const alertRows = deviceRows.length ? await db.select().from(securityAlerts).where(inArray(securityAlerts.deviceId, deviceRows.map(device => device.id))).orderBy(desc(securityAlerts.lastSeenAt)).limit(50) : [];
  const [walletRow] = await db.select().from(appSettings).where(eq(appSettings.key, `iris_local_wallet_session:${user.email}`)).limit(1);
  const [deskRow] = await db.select().from(appSettings).where(eq(appSettings.key, `iris_purchase_desk:${user.email}`)).limit(1);
  const wallet = parseWalletSessionValue(walletRow?.value || "");
  const pendingPurchases = parsePurchaseDesk(deskRow?.value || "").proposals.filter(item => item.status === "awaiting_approval").length;
  const mappedDevices = deviceRows.map(device => ({ id: device.id, name: device.name, platform: device.platform, status: reportedDeviceStatus(device), risk: device.risk, lastSeenAt: device.lastSeenAt, telemetry: parseJsonRecord(device.telemetry) }));
  const agents = liveWorkers({
    devices: mappedDevices,
    walletConnected: Boolean(wallet),
    walletAddress: wallet?.address,
    marketLive: true,
    auditCount: 1,
    pendingPurchases,
    language,
  });
  const question = [...messages].reverse().find(message => message.role === "user")?.content || "";
  const analystInput = {
    language,
    question,
    userName: user.displayName || user.email,
    origin: new URL(request.url).origin,
    section: typeof preferences.section === "string" ? preferences.section.slice(0, 40) : "operations",
    devices: mappedDevices,
    alerts: alertRows.map(alert => ({ deviceId: alert.deviceId, code: alert.code, severity: alert.severity, status: alert.status, evidence: parseJsonRecord(alert.evidence), lastSeenAt: alert.lastSeenAt })),
    agents: agents.map(agent => ({ id: agent.id, role: agent.role, status: agent.status, task: agent.task })),
    wallet: { connected: Boolean(wallet), address: wallet?.address || "" },
  };

  if (isMarketQuestion(question) || preferences.section === "market") {
    try {
      const ticker = extractTicker(question);
      const [tape, chart] = await Promise.all([
        fetchLiveTape(),
        ticker ? fetchMarketChart(ticker, "1d").catch(() => null) : Promise.resolve(null),
      ]);
      const board = {
        updatedAt: tape.updatedAt,
        live: tape.live,
        quotes: tape.quotes,
        ideas: [],
        briefing: briefingFromBoard(tape.quotes, []),
      };
      const answer = marketAnswer(question, language, board, chart);
      await logAudit(user.email, "ASK_IRIS_ANALYSIS", "live_market", "SUCCESS", { model: "iris-jar-live", ticker: ticker || "" });
      return Response.json({ answer, source: "live-market" });
    } catch {
      const tape = await fetchLiveTape().catch(() => null);
      if (tape?.quotes.length) {
        const lead = tape.quotes.slice(0, 4).map(item => `${item.symbol} ${item.price} (${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%)`).join(" · ");
        return Response.json({
          answer: language === "es"
            ? `IRIS en vivo. Cinta ahora: ${lead}. Si quieres una lectura de un ticker, dímelo.`
            : `IRIS is live. Tape now: ${lead}. Ask for a ticker if you want a reading.`,
          source: "live-market",
        });
      }
    }
  }

  const mind = await irisMindAnswer(analystInput);
  const apiKey = (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  if (!apiKey) {
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "SUCCESS", { model: mind.source === "world" ? "iris-world" : "iris-local-analyst" });
    return Response.json({ answer: mind.answer, source: mind.source });
  }

  const safeContext = JSON.stringify({ ...analystInput, question: undefined }).slice(0, 24000);
  const transcript = messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  const input = `CURRENT IRIS CONTEXT\n${safeContext}\n\nCONVERSATION\n${transcript}`;

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.6-sol", instructions: `You are IRIS, a warm, composed and highly capable enterprise cybersecurity copilot. Speak like a thoughtful human colleague, not a status bot. Answer in the user's language (normally Spanish) with natural phrasing, varied sentence length and smooth conversational transitions.

Address the user by their first name only occasionally. Lead with the direct answer. Explain technical findings in plain language before using security terminology. Ask one useful follow-up question only when it genuinely advances the investigation. Avoid canned phrases, stiff corporate language, repeated introductions, excessive headings and long bullet lists. For ordinary questions, use two to four short paragraphs. For a requested full review, give a clear prioritized summary.

Analyze only the supplied IRIS context. Device telemetry marked ONLINE with a recent lastSeenAt may be described as reported telemetry; PENDING, OFFLINE, absent or empty telemetry must never be described as a live scan. Clearly distinguish demonstration incidents from verified device telemetry. Never claim access to the user's computer, network, files or external systems unless the context proves it. Cite relevant incident IDs or device names naturally. Do not invent alerts, evidence, file paths, locations or completed actions. Recommend reversible next steps and state uncertainty honestly.

When the user asks by voice for the system status, answer aloud naturally and concisely in this order: device connection and report time, health/risk, protection controls, active verified findings, and recommended next action. For threat location, say the exact file or application path only when a locations or threatLocations field supplies it. Otherwise explain that IRIS knows the affected device or application but does not yet have a verified filesystem path. Never call a user-approved application malware merely because its signature could not be verified.`, input, max_output_tokens: 1100 }) });
    const payload = await openaiResponse.json() as { error?: { message?: string }; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
    if (!openaiResponse.ok) throw new Error(payload.error?.message || "OpenAI request failed.");
    const answer = payload.output?.flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join("\n").trim();
    if (!answer) throw new Error("IRIS returned an empty analysis.");
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "SUCCESS", { model: "gpt-5.6-sol" });
    return Response.json({ answer, source: "openai" });
  } catch {
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "SUCCESS", { model: mind.source === "world" ? "iris-world" : "iris-local-analyst", fallback: true });
    return Response.json({ answer: mind.answer, source: mind.source });
  }
}
