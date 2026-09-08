export type VoiceErrorCode = "unsupported" | "denied" | "network" | "no-speech" | "audio-capture" | "aborted" | "unknown";

const WAKE_PATTERN = /(?:(?:oye|hey|ok|okay|hola|escucha|okey)\s+)?iris\b/i;
const STOP_PATTERN = /^(?:stop|para|p[aá]rate|detente|silencio|c[aá]llate|callate|quiet|cancel)(?:\s+iris)?$/i;

export function recognitionLanguage(language: "es" | "en") {
  return language === "es" ? "es-MX" : "en-US";
}

export function normalizeVoiceTranscript(value: string) {
  return value.toLocaleLowerCase().replace(/[.,!?¿¡;:]/g, " ").replace(/\s+/g, " ").trim();
}

export function extractVoiceCommand(transcript: string, language: "es" | "en") {
  const trimmed = transcript.trim();
  if (!trimmed) return "";
  const normalized = normalizeVoiceTranscript(trimmed);
  if (STOP_PATTERN.test(normalized)) return "";
  const wakeMatch = trimmed.match(WAKE_PATTERN);
  if (wakeMatch) {
    return trimmed.slice((wakeMatch.index || 0) + wakeMatch[0].length).replace(/^[,.:;\s]+/, "").trim();
  }
  if (normalized.split(" ").length >= 3) return trimmed;
  return "";
}

export function defaultVoiceQuestion(language: "es" | "en") {
  return language === "es"
    ? "¿Cuál es el estado completo del sistema y dónde están las amenazas detectadas?"
    : "What is the complete system status and where are the detected threats?";
}

export function isStopCommand(transcript: string) {
  return STOP_PATTERN.test(normalizeVoiceTranscript(transcript));
}

export function hasWakePhrase(transcript: string) {
  return WAKE_PATTERN.test(transcript);
}

export function voiceErrorMessage(code: VoiceErrorCode, language: "es" | "en") {
  const es = language === "es";
  if (code === "unsupported") return es ? "IRIS no pudo usar el micrófono. Pulsa el botón otra vez y permite el acceso, o escribe tu pregunta." : "IRIS could not use the microphone. Tap the button again and allow access, or type your question.";
  if (code === "denied") return es ? "El micrófono está bloqueado. En la barra del navegador permite el micrófono para IRIS y vuelve a pulsar el botón." : "The microphone is blocked. Allow the microphone for IRIS in the browser bar, then tap the button again.";
  if (code === "audio-capture") return es ? "No encuentro un micrófono. Conecta uno y vuelve a intentarlo." : "No microphone was found. Connect one and try again.";
  if (code === "network") return es ? "Chrome no pudo usar el servicio de voz. Necesita conexión y un micrófono real en tu equipo." : "Chrome could not reach the speech service. It needs a network connection and a real microphone on your computer.";
  if (code === "no-speech") return es ? "Sigo escuchando. Habla cerca del micrófono y dime tu pregunta." : "Still listening. Speak near the microphone and ask your question.";
  if (code === "aborted") return "";
  return es ? "No pude activar el comando de voz. Pulsa el micrófono otra vez o escribe tu pregunta." : "Voice command could not start. Tap the microphone again or type your question.";
}

export function isRetryableVoiceError(code: VoiceErrorCode) {
  return code === "no-speech" || code === "aborted";
}

export function spokenQuestionFromTranscript(transcript: string) {
  const text = transcript.trim();
  if (!text || isStopCommand(text)) return "";
  return text;
}

export function isHearingVoice(level: number) {
  return level >= 0.035;
}

export async function openMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("unsupported"), { code: "unsupported" as VoiceErrorCode });
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
}

export function releaseMicrophone(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach(track => track.stop());
}

export function monitorMicrophoneLevel(stream: MediaStream, onLevel: (level: number) => void) {
  const audio = new AudioContext();
  const source = audio.createMediaStreamSource(stream);
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let frame = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const value = (sample - 128) / 128;
      sum += value * value;
    }
    onLevel(Math.sqrt(sum / samples.length));
    frame = requestAnimationFrame(tick);
  };
  void audio.resume();
  tick();
  return () => {
    cancelAnimationFrame(frame);
    source.disconnect();
    void audio.close();
  };
}

export function mapRecognitionError(error: string): VoiceErrorCode {
  if (error === "not-allowed" || error === "service-not-allowed") return "denied";
  if (error === "network") return "network";
  if (error === "no-speech") return "no-speech";
  if (error === "audio-capture") return "audio-capture";
  if (error === "aborted") return "aborted";
  return "unknown";
}

export async function requestMicrophone() {
  const stream = await openMicrophone();
  releaseMicrophone(stream);
}
