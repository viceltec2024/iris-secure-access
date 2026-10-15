import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser } from "../../../lib/authz";

export const dynamic = "force-dynamic";

/** Rachel — default feminine multilingual voice; override with ELEVENLABS_VOICE_ID. */
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

function voiceBindings() {
  const bindings = env as unknown as Record<string, string | undefined>;
  const apiKey = (bindings.ELEVENLABS_API_KEY || "").trim();
  const voiceId = (bindings.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID).trim();
  const modelId = (bindings.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID).trim();
  return { apiKey, voiceId, modelId };
}

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { apiKey, voiceId } = voiceBindings();
  return Response.json({ tts: Boolean(apiKey && voiceId), provider: "elevenlabs" });
}

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Your IRIS session has expired." }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "IRIS access is suspended." }, { status: 403 });

  let body: { text?: unknown; language?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 3600) : "";
  if (!text) return Response.json({ error: "Text is required." }, { status: 400 });

  const { apiKey, voiceId, modelId } = voiceBindings();
  if (!apiKey || !voiceId) return Response.json({ error: "IRIS voice is not configured." }, { status: 503 });

  const spanish = body.language === "es" || /[áéíóúñ¿¡]|\b(hola|gracias|sistema|seguridad|amenaza|equipo|aplicaci[oó]n)\b/i.test(text);
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  url.searchParams.set("output_format", "mp3_44100_128");

  const payload: Record<string, unknown> = {
    text,
    model_id: modelId,
    voice_settings: {
      stability: 0.42,
      similarity_boost: 0.78,
      style: 0.12,
      speed: 0.96,
      use_speaker_boost: true,
    },
  };
  // Flash / turbo models accept an explicit language hint; multilingual_v2 ignores it.
  if (!/multilingual_v2/i.test(modelId)) {
    payload.language_code = spanish ? "es" : "en";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    return Response.json({ error: "IRIS could not generate speech." }, { status: 502 });
  }
  return new Response(response.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
      "X-IRIS-Voice": "elevenlabs",
    },
  });
}
