export type RecordControl = {
  stop(): void;
  done: Promise<Blob | null>;
};

const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

export function recordingMimeType(isTypeSupported: (type: string) => boolean = type => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
  return AUDIO_TYPES.find(type => isTypeSupported(type)) || "";
}

export function canRecordVoice() {
  return typeof MediaRecorder === "function";
}

export function fileNameForAudioType(type: string) {
  if (type.includes("mp4")) return "iris.m4a";
  if (type.includes("ogg")) return "iris.ogg";
  return "iris.webm";
}

export function shouldFinishRecording({
  speechMs,
  silentMs,
  elapsedMs,
  minSpeechMs = 280,
  silenceMs = 900,
  maxMs = 12000,
}: {
  speechMs: number;
  silentMs: number;
  elapsedMs: number;
  minSpeechMs?: number;
  silenceMs?: number;
  maxMs?: number;
}) {
  if (elapsedMs >= maxMs) return true;
  return speechMs >= minSpeechMs && silentMs >= silenceMs;
}

export function mapMediaError(error: unknown): "denied" | "audio-capture" | "unsupported" | "unknown" {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "NotReadableError") return "audio-capture";
  if (name === "NotSupportedError") return "unsupported";
  return "unknown";
}

export function recordSpokenUtterance(
  stream: MediaStream,
  options: {
    isActive(): boolean;
    isHearing(): boolean;
    maxMs?: number;
    silenceMs?: number;
    minSpeechMs?: number;
  },
): RecordControl {
  const mime = recordingMimeType();
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  let speechMs = 0;
  let silentMs = 0;
  const started = performance.now();
  let last = started;
  let timer = 0;

  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const done = new Promise<Blob | null>(resolve => {
    recorder.onstop = () => {
      if (timer) window.clearInterval(timer);
      if (!chunks.length || speechMs < (options.minSpeechMs ?? 280)) {
        resolve(null);
        return;
      }
      resolve(new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" }));
    };
    recorder.onerror = () => {
      if (timer) window.clearInterval(timer);
      resolve(null);
    };
  });

  const finish = () => {
    if (recorder.state === "recording") recorder.stop();
    else if (timer) window.clearInterval(timer);
  };

  timer = window.setInterval(() => {
    const now = performance.now();
    const delta = now - last;
    last = now;
    if (options.isHearing()) {
      speechMs += delta;
      silentMs = 0;
    } else if (speechMs > 0) {
      silentMs += delta;
    }
    if (!options.isActive() || shouldFinishRecording({
      speechMs,
      silentMs,
      elapsedMs: now - started,
      minSpeechMs: options.minSpeechMs,
      silenceMs: options.silenceMs,
      maxMs: options.maxMs,
    })) finish();
  }, 80);

  try {
    recorder.start(250);
  } catch {
    if (timer) window.clearInterval(timer);
    return { stop() {}, done: Promise.resolve(null) };
  }

  return { stop: finish, done };
}

export async function transcribeRecordedAudio(blob: Blob, language: "es" | "en") {
  const type = blob.type || "audio/webm";
  const file = new File([blob], fileNameForAudioType(type), { type });
  const form = new FormData();
  form.set("audio", file);
  form.set("language", language);
  const response = await fetch("/api/iris-transcribe", { method: "POST", body: form });
  const data = await response.json().catch(() => ({})) as { text?: string; error?: string };
  if (response.ok && data.text?.trim()) return data.text.trim();
  const local = await transcribeInBrowser(blob, language).catch(() => "");
  if (local) return local;
  throw new Error(data.error || "IRIS could not hear that.");
}

async function transcribeInBrowser(blob: Blob, language: "es" | "en") {
  const decoded = await decodeAudioBlob(blob);
  if (!decoded?.length) return "";
  const transformers = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/+esm") as {
    pipeline: (task: string, model: string, options?: { quantized?: boolean }) => Promise<(audio: Float32Array, options: { language: string; task: string }) => Promise<{ text?: string } | string>>;
    env?: { allowLocalModels?: boolean };
  };
  if (transformers.env) transformers.env.allowLocalModels = false;
  const transcriber = await transformers.pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", { quantized: true });
  const result = await transcriber(decoded, { language: language === "es" ? "spanish" : "english", task: "transcribe" });
  return (typeof result === "string" ? result : result?.text || "").trim();
}

async function decodeAudioBlob(blob: Blob) {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channel = buffer.numberOfChannels > 1 ? mixToMono(buffer) : buffer.getChannelData(0);
    return downsample(channel, buffer.sampleRate, 16000);
  } finally {
    if (context.state !== "closed") {
      try { await Promise.resolve(context.close()).catch(() => undefined); } catch { /* already closed */ }
    }
  }
}

function mixToMono(buffer: AudioBuffer) {
  const length = buffer.length;
  const mixed = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) mixed[index] += data[index] / buffer.numberOfChannels;
  }
  return mixed;
}

function downsample(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = input[Math.min(input.length - 1, Math.round(index * ratio))] || 0;
  }
  return output;
}
