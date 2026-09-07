import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser } from "../../../lib/authz";
import { enforceRateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 2_000_000;

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  return Response.json({ transcribe: Boolean(apiKey), tts: Boolean(apiKey) });
}

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Your IRIS session has expired." }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "IRIS access is suspended." }, { status: 403 });
  if (!(await enforceRateLimit(`iris-transcribe:${user.email}`, 20, 60 * 1000))) {
    return Response.json({ error: "Too many voice requests." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const apiKey = (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Voice transcription is not configured." }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File) || audio.size < 64 || audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Invalid audio." }, { status: 400 });
  }

  const language = String(form?.get("language") || "es") === "en" ? "en" : "es";
  const body = new FormData();
  body.set("file", audio, audio.name || "iris.webm");
  body.set("model", "whisper-1");
  body.set("language", language);
  body.set("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const payload = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string } };
  if (!response.ok || !payload.text?.trim()) {
    return Response.json({ error: payload.error?.message || "IRIS could not hear that." }, { status: 502 });
  }
  return Response.json({ text: payload.text.trim() });
}
