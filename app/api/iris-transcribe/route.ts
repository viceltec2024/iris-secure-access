import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser } from "../../../lib/authz";
import { enforceRateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 2_000_000;

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const bindings = env as unknown as { OPENAI_API_KEY?: string; AI?: unknown };
  return Response.json({ transcribe: Boolean(bindings.OPENAI_API_KEY || bindings.AI), tts: Boolean(bindings.OPENAI_API_KEY) });
}

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Your IRIS session has expired." }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "IRIS access is suspended." }, { status: 403 });
  if (!(await enforceRateLimit(`iris-transcribe:${user.email}`, 20, 60 * 1000))) {
    return Response.json({ error: "Too many voice requests." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const bindings = env as unknown as {
    OPENAI_API_KEY?: string;
    AI?: { run(model: string, input: Record<string, unknown>): Promise<{ text?: string }> };
  };

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File) || audio.size < 64 || audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Invalid audio." }, { status: 400 });
  }

  const language = String(form?.get("language") || "es") === "en" ? "en" : "es";
  const text = await transcribeAudioFile(audio, language, bindings);
  if (!text) return Response.json({ error: "IRIS could not hear that." }, { status: bindings.OPENAI_API_KEY || bindings.AI ? 502 : 503 });
  return Response.json({ text });
}

async function transcribeAudioFile(audio: File, language: "es" | "en", bindings: {
  OPENAI_API_KEY?: string;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<{ text?: string }> };
}) {
  if (bindings.OPENAI_API_KEY) {
    const body = new FormData();
    body.set("file", audio, audio.name || "iris.webm");
    body.set("model", "whisper-1");
    body.set("language", language);
    body.set("response_format", "json");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${bindings.OPENAI_API_KEY}` },
      body,
    });
    const payload = await response.json().catch(() => ({})) as { text?: string };
    if (response.ok && payload.text?.trim()) return payload.text.trim();
  }

  if (bindings.AI?.run) {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const result = await bindings.AI.run("@cf/openai/whisper", { audio: Array.from(bytes) }).catch(() => ({ text: "" }));
    if (result.text?.trim()) return result.text.trim();
  }

  return "";
}
