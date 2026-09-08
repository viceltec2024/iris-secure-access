import { isAmbiguousStopPrefix, isBargeInStop, isStopRequest } from "../../lib/iris-query.ts";

export type VoiceErrorCode = "unsupported" | "denied" | "network" | "no-speech" | "audio-capture" | "aborted" | "unknown";

const WAKE_PATTERN = /(?:(?:oye|hey|ok|okay|hola|escucha|okey)\s+)?iris\b/i;

export function recognitionLanguage(language: "es" | "en") {
  return language === "es" ? "es-MX" : "en-US";
}

export function normalizeVoiceTranscript(value: string) {
  return value.toLocaleLowerCase().replace(/[.,!?¿¡;:]/g, " ").replace(/\s+/g, " ").trim();
}

export function extractVoiceCommand(transcript: string) {
  const trimmed = transcript.trim();
  if (!trimmed) return "";
  const normalized = normalizeVoiceTranscript(trimmed);
  if (isStopCommand(trimmed)) return "";
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
  return isStopRequest(transcript);
}

export { isAmbiguousStopPrefix, isBargeInStop };

export function hasWakePhrase(transcript: string) {
  return WAKE_PATTERN.test(transcript);
}

export function voiceErrorMessage(code: VoiceErrorCode, language: "es" | "en") {
  const es = language === "es";
  if (code === "unsupported") return es ? "Este navegador no puede abrir el micrófono. Sigue escribiendo: IRIS ya te contesta por texto." : "This browser cannot open the microphone. Keep typing: IRIS already answers in writing.";
  if (code === "denied") return es ? "Chrome bloqueó el micrófono. Pulsa el candado de la barra, permite el micrófono para este sitio y vuelve a pulsar el icono. Mientras tanto puedes escribir." : "Chrome blocked the microphone. Tap the lock in the address bar, allow the microphone for this site, and tap the icon again. You can keep typing in the meantime.";
  if (code === "audio-capture") return es ? "No pude conectar el micrófono. En Chrome permite el micrófono para esta pestaña, cierra Zoom o Meet si lo están usando, y pulsa el icono otra vez. Mientras tanto escribe tu pregunta: IRIS sí está conectada por texto." : "I could not connect the microphone. In Chrome, allow the microphone for this tab, close Zoom or Meet if they are using it, and tap the icon again. Keep typing: IRIS is connected in writing.";
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

export function releaseAudioForMicrophone() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
  stopSpeechEnginePlayback();
  releaseSpeechHold();
}

export async function openMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("unsupported"), { name: "NotSupportedError", code: "unsupported" as VoiceErrorCode });
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    const code = mapMediaErrorFromName(error instanceof Error ? error.name : "");
    if (code === "denied" || code === "unsupported") throw error;
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

export function releaseMicrophone(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach(track => track.stop());
}

const closingAudio = new WeakSet<object>();

export function closeAudioContext(audio: { state: string; close(): Promise<void> } | null | undefined) {
  if (!audio || audio.state === "closed" || closingAudio.has(audio)) return Promise.resolve();
  closingAudio.add(audio);
  try {
    return Promise.resolve(audio.close()).then(() => undefined, () => undefined);
  } catch {
    return Promise.resolve();
  }
}

export function resumeSpeechIfPaused(synth: { paused?: boolean; resume(): void } | null | undefined) {
  if (!synth?.paused) return;
  try { synth.resume(); } catch { /* ignore */ }
}

export function monitorMicrophoneLevel(stream: MediaStream, onLevel: (level: number) => void) {
  const audio = new AudioContext();
  const source = audio.createMediaStreamSource(stream);
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let frame = 0;
  let stopped = false;
  const tick = () => {
    if (stopped || audio.state === "closed") return;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const value = (sample - 128) / 128;
      sum += value * value;
    }
    onLevel(Math.sqrt(sum / samples.length));
    frame = requestAnimationFrame(tick);
  };
  void audio.resume().catch(() => undefined);
  tick();
  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    try { source.disconnect(); } catch { /* already disconnected */ }
    void closeAudioContext(audio);
  };
}

function mapMediaErrorFromName(name: string): VoiceErrorCode | "" {
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "NotReadableError") return "audio-capture";
  if (name === "NotSupportedError") return "unsupported";
  return "";
}

export function mapRecognitionError(error: string): VoiceErrorCode {
  if (error === "not-allowed" || error === "service-not-allowed") return "denied";
  if (error === "network") return "network";
  if (error === "no-speech") return "no-speech";
  if (error === "audio-capture") return "audio-capture";
  if (error === "aborted") return "aborted";
  return "unknown";
}

export function splitSpeechChunks(text: string, max = 220) {
  const chunks: string[] = [];
  let current = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      chunks.push(current);
      current = word;
    } else current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function scoreSpeechVoice(voice: { name: string; lang: string; localService?: boolean }, language: "es" | "en") {
  const locale = language === "es" ? /^es([_-]|$)/i : /^en([_-]|$)/i;
  if (!locale.test(voice.lang)) return language === "es" && /^en([_-]|$)/i.test(voice.lang) ? 0.2 : 0;
  if (/premium|enhanced|natural|neural|siri|google|ava|samantha|paulina|m[oó]nica/i.test(voice.name)) return 3;
  if (voice.localService) return 2;
  return 1;
}

export function pickSpeechVoice(voices: Array<{ name: string; lang: string; localService?: boolean }>, language: "es" | "en") {
  const ranked = [...voices].sort((left, right) => scoreSpeechVoice(right, language) - scoreSpeechVoice(left, language));
  const best = ranked[0];
  return best && scoreSpeechVoice(best, language) >= 1 ? best : undefined;
}

export function speechVolumeHint(language: "es" | "en", state: { blocked?: boolean; voices?: number; speaking?: boolean }) {
  const es = language === "es";
  if (state.blocked) return es ? "El navegador bloqueó el audio. Pulsa el altavoz, permite el sonido de esta pestaña y sube el volumen del Mac." : "The browser blocked audio. Tap the speaker, allow sound for this tab, and turn the Mac volume up.";
  if (!state.voices) return es ? "Este equipo no tiene voces instaladas. En el Mac: Ajustes → Accesibilidad → Contenido hablado. Luego pulsa el altavoz de IRIS." : "This computer has no voices installed. On the Mac: Settings → Accessibility → Spoken Content. Then tap the IRIS speaker.";
  if (state.speaking) return es ? "IRIS te está hablando. Si no oyes nada, sube el volumen y comprueba que el Mac no está en silencio." : "IRIS is speaking. If you hear nothing, turn the volume up and check the Mac is not muted.";
  return es ? "IRIS ya contestó por escrito. Pulsa el altavoz para oírla." : "IRIS already answered in writing. Tap the speaker to hear it.";
}

export function irisListenPhrase(language: "es" | "en") {
  return language === "es" ? "Hola. Soy IRIS. Te escucho." : "Hi. I'm IRIS. I'm listening.";
}

let speechUnlocked = false;
let browserSpeechPrimed = false;
let speechContext: AudioContext | null = null;
let speechSource: AudioBufferSourceNode | null = null;
let holdNode: OscillatorNode | null = null;
let htmlAudio: HTMLAudioElement | null = null;

function primeBrowserSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || browserSpeechPrimed) return;
  resumeSpeechIfPaused(window.speechSynthesis);
  browserSpeechPrimed = true;
}

export function unlockSpeechEngine() {
  if (typeof window === "undefined") return;
  primeBrowserSpeech();
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  if (!speechContext || speechContext.state === "closed") speechContext = new Ctor();
  void speechContext.resume().catch(() => undefined);
  if (speechUnlocked) return;
  const gain = speechContext.createGain();
  gain.gain.value = 0.0001;
  const oscillator = speechContext.createOscillator();
  oscillator.connect(gain);
  gain.connect(speechContext.destination);
  oscillator.start();
  oscillator.stop(speechContext.currentTime + 0.04);
  speechUnlocked = true;
}

export function holdSpeechSession() {
  unlockSpeechEngine();
  if (!speechContext || speechContext.state === "closed" || holdNode) return;
  const oscillator = speechContext.createOscillator();
  const gain = speechContext.createGain();
  gain.gain.value = 0.00001;
  oscillator.connect(gain);
  gain.connect(speechContext.destination);
  oscillator.start();
  holdNode = oscillator;
}

export function releaseSpeechHold() {
  if (!holdNode) return;
  try { holdNode.stop(); } catch { /* already stopped */ }
  try { holdNode.disconnect(); } catch { /* already disconnected */ }
  holdNode = null;
}

export function stopHtmlAudio() {
  if (!htmlAudio) return;
  try { htmlAudio.pause(); } catch { /* already paused */ }
  htmlAudio.removeAttribute("src");
  htmlAudio = null;
}

export function stopSpeechEnginePlayback() {
  stopHtmlAudio();
  releaseSpeechHold();
  if (!speechSource) return;
  try { speechSource.stop(); } catch { /* already stopped */ }
  try { speechSource.disconnect(); } catch { /* already disconnected */ }
  speechSource = null;
}

export const SPEECH_CANCEL_GAP_MS = 50;

export function shouldRepeatThinkingPhrase(loading: boolean, queuedAnswer?: string | null) {
  return Boolean(loading && !(queuedAnswer && queuedAnswer.trim()));
}

export function shouldForceSpeechRetry(started: boolean) {
  return !started;
}

export function speakBrowserText(
  text: string,
  language: "es" | "en",
  voices: Array<{ name: string; lang: string; localService?: boolean }>,
  handlers: { onStart?: () => void; onEnd?: () => void; onBlocked?: () => void } = {},
) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    handlers.onBlocked?.();
    handlers.onEnd?.();
    return () => undefined;
  }
  const synth = window.speechSynthesis;
  resumeSpeechIfPaused(synth);
  const needsGap = Boolean(synth.speaking || synth.pending);
  if (needsGap) synth.cancel();
  const catalog = synth.getVoices();
  const preferred = pickSpeechVoice(catalog.length ? catalog : voices, language);
  const liveVoice = preferred ? catalog.find(voice => voice.name === preferred.name && voice.lang === preferred.lang) : undefined;
  const chunks = splitSpeechChunks(text);
  let index = 0;
  let stopped = false;
  let started = false;
  let finished = false;
  let watchdog = 0;
  let startTimer = 0;
  const clearTimers = () => {
    if (watchdog) window.clearTimeout(watchdog);
    if (startTimer) window.clearTimeout(startTimer);
    watchdog = 0;
    startTimer = 0;
  };
  const finish = (blocked = false) => {
    if (finished) return;
    finished = true;
    clearTimers();
    if (blocked) handlers.onBlocked?.();
    handlers.onEnd?.();
  };
  const stop = () => {
    stopped = true;
    clearTimers();
    synth.cancel();
  };
  const makeUtterance = (chunk: string, attachVoice: boolean) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = liveVoice?.lang || (language === "es" ? "es-MX" : "en-US");
    if (attachVoice && liveVoice) utterance.voice = liveVoice;
    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => {
      started = true;
      handlers.onStart?.();
    };
    utterance.onend = () => {
      if (stopped) return;
      index += 1;
      speakChunk(attachVoice);
    };
    utterance.onerror = event => {
      const error = "error" in event ? String((event as { error?: string }).error || "") : "";
      if (error === "canceled" || error === "interrupted") return;
      if (stopped) return;
      index += 1;
      speakChunk(attachVoice);
    };
    return utterance;
  };
  const speakChunk = (attachVoice = true) => {
    if (stopped || finished) return;
    if (index >= chunks.length) {
      finish(false);
      return;
    }
    resumeSpeechIfPaused(synth);
    synth.speak(makeUtterance(chunks[index], attachVoice));
  };
  const begin = (attachVoice: boolean) => {
    if (stopped || finished) return;
    speakChunk(attachVoice);
  };
  if (needsGap) startTimer = window.setTimeout(() => begin(true), SPEECH_CANCEL_GAP_MS);
  else begin(true);
  watchdog = window.setTimeout(() => {
    if (stopped || finished || !shouldForceSpeechRetry(started)) return;
    resumeSpeechIfPaused(synth);
    try { synth.cancel(); } catch { /* ignore */ }
    startTimer = window.setTimeout(() => {
      if (stopped || started || finished) return;
      index = 0;
      if (chunks[0]) synth.speak(makeUtterance(chunks[0], false));
      watchdog = window.setTimeout(() => {
        if (stopped || started || finished) return;
        stop();
        finish(true);
      }, 1400);
    }, SPEECH_CANCEL_GAP_MS);
  }, 900);
  return stop;
}

export async function playAudioBuffer(buffer: ArrayBuffer, onStart?: () => void) {
  unlockSpeechEngine();
  if (!speechContext || speechContext.state === "closed") throw new Error("unsupported");
  if (speechContext.state === "suspended") await speechContext.resume();
  if (speechContext.state !== "running") throw new Error("suspended");
  const decoded = await speechContext.decodeAudioData(buffer.slice(0));
  stopSpeechEnginePlayback();
  await new Promise<void>((resolve, reject) => {
    const source = speechContext!.createBufferSource();
    speechSource = source;
    source.buffer = decoded;
    source.connect(speechContext!.destination);
    source.onended = () => {
      if (speechSource === source) speechSource = null;
      resolve();
    };
    try {
      source.start();
      onStart?.();
    } catch (error) {
      if (speechSource === source) speechSource = null;
      reject(error);
    }
  });
}

export async function playMpegSpeech(buffer: ArrayBuffer, onStart?: () => void) {
  stopHtmlAudio();
  const url = URL.createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
  const audio = new Audio();
  htmlAudio = audio;
  audio.src = url;
  audio.preload = "auto";
  let started = false;
  const markStart = () => {
    if (started) return;
    started = true;
    onStart?.();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("html-audio"));
      audio.onplay = markStart;
      void audio.play().then(markStart, reject);
    });
  } catch {
    URL.revokeObjectURL(url);
    if (htmlAudio === audio) htmlAudio = null;
    await playAudioBuffer(buffer, onStart);
    return;
  }
  URL.revokeObjectURL(url);
  if (htmlAudio === audio) htmlAudio = null;
}
