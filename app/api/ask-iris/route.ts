import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../lib/authz";

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

  const safeContext = JSON.stringify(body.context ?? {}).slice(0, 12000);
  const transcript = messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  const input = `CURRENT IRIS CONTEXT\n${safeContext}\n\nCONVERSATION\n${transcript}`;

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.6-sol", instructions: "You are IRIS, an enterprise cybersecurity operations assistant. Answer in the user's language, normally Spanish. Analyze only the IRIS context provided. Clearly distinguish displayed/demo telemetry from verified live telemetry; never claim access to the user's computer, network, files, or external systems unless the context proves it. Prioritize incidents, cite incident IDs and evidence, explain risk in plain language, and recommend reversible next steps. Do not invent alerts or claim an action was executed. Keep normal responses concise but provide a complete system summary when asked.", input, max_output_tokens: 900 }) });
    const payload = await openaiResponse.json() as { error?: { message?: string }; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
    if (!openaiResponse.ok) throw new Error(payload.error?.message || "OpenAI request failed.");
    const answer = payload.output?.flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join("\n").trim();
    if (!answer) throw new Error("IRIS returned an empty analysis.");
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "SUCCESS", { model: "gpt-5.6-sol" });
    return Response.json({ answer });
  } catch (error) {
    await logAudit(user.email, "ASK_IRIS_ANALYSIS", "security_context", "DENIED", { reason: "provider_error" });
    return Response.json({ error: error instanceof Error ? error.message : "IRIS is temporarily unavailable." }, { status: 502 });
  }
}
