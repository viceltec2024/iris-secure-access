import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser } from "../../../lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Your IRIS session has expired." }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "IRIS access is suspended." }, { status: 403 });

  let body: { text?: unknown; language?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 3600) : "";
  if (!text) return Response.json({ error: "Text is required." }, { status: 400 });

  const apiKey = (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "IRIS voice is not configured." }, { status: 503 });
  const spanish = body.language === "es" || /[áéíóúñ¿¡]|\b(hola|gracias|sistema|seguridad|amenaza|equipo|aplicaci[oó]n)\b/i.test(text);
  const instructions = spanish
    ? "Habla en español latinoamericano neutro. Voz femenina adulta, cálida, humana, serena y segura. Ritmo conversacional natural, pronunciación clara, pausas suaves y breves. Evita tono de locutora, dramatismo, canto o cadencia robótica. Trata los términos técnicos con calma y precisión."
    : "Speak in natural American English. Use a warm, adult feminine voice that feels calm, human, intelligent, and reassuring. Keep a conversational pace with clear pronunciation and gentle brief pauses. Avoid announcer delivery, melodrama, singing, or robotic cadence. Handle technical terms calmly and precisely.";

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "marin", input: text, instructions, response_format: "mp3" }),
  });
  if (!response.ok || !response.body) return Response.json({ error: "IRIS could not generate speech." }, { status: 502 });
  return new Response(response.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "X-IRIS-Voice": "AI-generated" } });
}
