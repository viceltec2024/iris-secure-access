"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChatCircleDots, CornersIn, CornersOut, Microphone, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import { holdSpeechSession, irisListenPhrase, isHearingVoice, isRetryableVoiceError, isStopCommand, mapRecognitionError, monitorMicrophoneLevel, openMicrophone, playMpegSpeech, recognitionLanguage, releaseMicrophone, resumeSpeechIfPaused, speakBrowserText, spokenQuestionFromTranscript, stopSpeechEnginePlayback, unlockSpeechEngine, voiceErrorMessage } from "./iris-voice";
import { canRecordVoice, mapMediaError, recordSpokenUtterance, transcribeRecordedAudio, type RecordControl } from "./iris-record";
import IrisVoiceStage, { type VoiceStageMode } from "./iris-voice-stage";

type ChatMessage = { role: "user" | "assistant"; content: string };
type IncidentContext = { id: string; title: string; subject: string; severity: string; status: string; source: string; evidence: string[]; recommendation: string };
type DeviceContext = { id: string; name: string; platform: string; status: string; risk: string; lastSeenAt: string | null; telemetry?: string };
type SpeechResultEvent = { resultIndex?: number; results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }> };
type RecognitionInstance = { lang: string; continuous?: boolean; interimResults?: boolean; maxAlternatives?: number; start(): void; stop(): void; abort(): void; onend: (() => void) | null; onerror: ((event: { error?: string }) => void) | null; onresult: ((event: SpeechResultEvent) => void) | null };
type RecognitionConstructor = new () => RecognitionInstance;

const welcomeMessage = (language: Language, userName: string, section = "operations"): ChatMessage => ({ role: "assistant", content: language === "es"
  ? section === "market"
    ? `Hola, ${userName}. Soy IRIS. Estoy conectada a la bolsa en vivo: veo precios, te enseño el gráfico y te digo las lecturas más limpias. Pregúntame por un ticker o por las mejores opciones.`
    : `Hola, ${userName}. Soy IRIS. Estoy lista para revisar contigo lo que ocurre en el sistema. Puedes preguntarme con tus propias palabras.`
  : section === "market"
    ? `Hi, ${userName}. I'm IRIS. I am connected to the live market: I see prices, teach the chart, and give you the cleanest readings. Ask me for a ticker or the best options.`
    : `Hi, ${userName}. I'm IRIS. I'm ready to review what's happening in the system with you. Ask me anything in your own words.` });

export default function AskIrisPanel({ section, selectedIncident, userName, language }: { section: string; selectedIncident: IncidentContext; incidents: IncidentContext[]; devices: DeviceContext[]; userRole: string; userName: string; language: Language }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage(language, userName, section)]);
  useEffect(() => {
    setMessages(current => current.length === 1 && current[0].role === "assistant" ? [welcomeMessage(language, userName, section)] : current);
  }, [language, section, userName]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voiceHint, setVoiceHint] = useState("");
  const [neuralVoice, setNeuralVoice] = useState<boolean | null>(null);
  const [voiceStage, setVoiceStage] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [spokenAnswer, setSpokenAnswer] = useState("");
  const [hearing, setHearing] = useState(false);
  const [voiceEnergy, setVoiceEnergy] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [fullScreen, setFullScreen] = useState(false);
  const speakingRef = useRef(false);
  const loadingRef = useRef(false);
  const voiceStageRef = useRef(false);
  const listenActiveRef = useRef(false);
  const hearingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const recorderRef = useRef<RecordControl | null>(null);
  const recorderOnlyRef = useRef(false);
  const stopLevelMonitorRef = useRef<(() => void) | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const transcriptBufferRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const voiceRequestRef = useRef<AbortController | null>(null);
  const speechKeepAliveRef = useRef<number | null>(null);
  const startListeningRef = useRef<() => Promise<void>>(async () => undefined);
  const greetedRef = useRef(false);
  const skipResumeRef = useRef(false);
  const browserStopRef = useRef<(() => void) | null>(null);
  const autoSpeakRef = useRef(true);
  autoSpeakRef.current = autoSpeak;

  const voiceMode: VoiceStageMode = listening ? "listening" : loading || voiceLoading ? "thinking" : speaking ? "speaking" : "ready";

  useEffect(() => {
    void fetch("/api/iris-voice").then(response => response.ok ? response.json() : null).then((data: { tts?: boolean } | null) => setNeuralVoice(Boolean(data?.tts))).catch(() => setNeuralVoice(false));
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refreshVoices = () => setVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    return () => { window.speechSynthesis.cancel(); window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices); };
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  useEffect(() => () => { listenActiveRef.current = false; clearVoiceTimers(); stopSpeechKeepAlive(); recognitionRef.current?.abort(); stopLevelMonitorRef.current?.(); releaseMicrophone(streamRef.current); streamRef.current = null; voiceRequestRef.current?.abort(); audioRef.current?.pause(); if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); }, []);

  function detectedLanguage(text: string) {
    return language === "es" || /[áéíóúñ¿¡]/.test(text) ? "es" : "en";
  }

  function stopSpeechKeepAlive() {
    if (speechKeepAliveRef.current) window.clearInterval(speechKeepAliveRef.current);
    speechKeepAliveRef.current = null;
  }

  function startSpeechKeepAlive() {
    stopSpeechKeepAlive();
    speechKeepAliveRef.current = window.setInterval(() => {
      if (!("speechSynthesis" in window)) return;
      resumeSpeechIfPaused(window.speechSynthesis);
    }, 200);
  }

  function releaseMicForSpeech() {
    pauseRecognition();
    stopLevelMonitorRef.current?.();
    stopLevelMonitorRef.current = null;
    releaseMicrophone(streamRef.current);
    streamRef.current = null;
  }

  function browserVoiceFallback(text: string, spokenLanguage: "es" | "en") {
    return new Promise<void>(resolve => {
      if (!("speechSynthesis" in window)) {
        setVoiceHint(language === "es" ? "IRIS ya contestó por escrito. Este navegador no puede hablar en voz alta." : "IRIS already answered in writing. This browser cannot speak out loud.");
        if (!skipResumeRef.current) resumeVoiceConversation();
        skipResumeRef.current = false;
        resolve();
        return;
      }
      unlockSpeechEngine();
      releaseMicForSpeech();
      startSpeechKeepAlive();
      browserStopRef.current = speakBrowserText(text, spokenLanguage, voices, {
        onStart: () => {
          speakingRef.current = true;
          setSpeaking(true);
          setVoiceLoading(false);
          setVoiceHint(language === "es" ? "IRIS te está hablando. Sube el volumen." : "IRIS is speaking. Turn the volume up.");
        },
        onBlocked: () => {
          setVoiceHint(language === "es" ? "El navegador bloqueó el audio. Pulsa el altavoz y sube el volumen del Mac." : "The browser blocked audio. Tap the speaker and turn the Mac volume up.");
        },
        onEnd: () => {
          browserStopRef.current = null;
          stopSpeechKeepAlive();
          speakingRef.current = false;
          setSpeaking(false);
          setVoiceLoading(false);
          if (!skipResumeRef.current) resumeVoiceConversation();
          skipResumeRef.current = false;
          resolve();
        },
      });
    });
  }

  async function speak(text: string, options: { resume?: boolean } = {}) {
    skipResumeRef.current = options.resume === false;
    unlockSpeechEngine();
    holdSpeechSession();
    releaseMicForSpeech();
    stopVoice();
    const spokenLanguage = detectedLanguage(text);
    if (neuralVoice === false) {
      await browserVoiceFallback(text, spokenLanguage);
      return;
    }
    const controller = new AbortController(); voiceRequestRef.current = controller; setVoiceLoading(true);
    try {
      const response = await fetch("/api/iris-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language: spokenLanguage }), signal: controller.signal });
      if (!response.ok) throw new Error("voice unavailable");
      const buffer = await response.arrayBuffer();
      if (controller.signal.aborted) return;
      await playMpegSpeech(buffer, () => {
        speakingRef.current = true;
        setSpeaking(true);
        setVoiceLoading(false);
        setVoiceHint(language === "es" ? "IRIS te está hablando. Sube el volumen." : "IRIS is speaking. Turn the volume up.");
      });
      if (!controller.signal.aborted) finishNeuralVoice();
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      voiceRequestRef.current = null;
      setVoiceLoading(false);
      if (aborted) {
        speakingRef.current = false;
        setSpeaking(false);
        skipResumeRef.current = false;
        return;
      }
      await browserVoiceFallback(text, spokenLanguage);
    }
  }

  function clearVoiceTimers() {
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    restartTimerRef.current = null;
    debounceTimerRef.current = null;
  }

  function pauseRecognition() {
    listenActiveRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    clearVoiceTimers();
    setListening(false);
  }

  function resumeVoiceConversation() {
    if (voiceStageRef.current && !loadingRef.current) setTimeout(() => void startListeningRef.current(), 400);
  }

  function finishNeuralVoice() {
    voiceRequestRef.current = null; speakingRef.current = false; setSpeaking(false); setVoiceLoading(false); audioRef.current = null;
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
    if (!skipResumeRef.current) resumeVoiceConversation();
    skipResumeRef.current = false;
  }

  function openVoiceStage() {
    voiceStageRef.current = true;
    setVoiceStage(true);
    setAutoSpeak(true);
    setOpen(true);
  }

  function closeVoiceStage() {
    voiceStageRef.current = false;
    listenActiveRef.current = false;
    setVoiceStage(false);
    setListening(false);
    setHearing(false);
    setVoiceEnergy(0);
    setLiveTranscript("");
    transcriptBufferRef.current = "";
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    recorderOnlyRef.current = false;
    stopLevelMonitorRef.current?.();
    stopLevelMonitorRef.current = null;
    releaseMicrophone(streamRef.current);
    streamRef.current = null;
    clearVoiceTimers();
    stopVoice();
  }

  function stopVoice() { browserStopRef.current?.(); browserStopRef.current = null; stopSpeechEnginePlayback(); stopSpeechKeepAlive(); voiceRequestRef.current?.abort(); voiceRequestRef.current = null; audioRef.current?.pause(); audioRef.current = null; if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; } if ("speechSynthesis" in window) window.speechSynthesis.cancel(); speakingRef.current = false; setSpeaking(false); setVoiceLoading(false); }
  function toggleAutoSpeak() {
    setAutoSpeak(value => {
      const next = !value;
      if (!next) stopVoice();
      else {
        const latest = spokenAnswer || messages.filter(item => item.role === "assistant").at(-1)?.content || "";
        if (latest) void speak(latest, { resume: false });
      }
      return next;
    });
  }

  async function sendMessage(text = input) {
    unlockSpeechEngine();
    holdSpeechSession();
    const clean = text.trim();
    if (!clean || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content: clean }];
    setMessages(nextMessages); setInput(""); loadingRef.current = true; setLoading(true); pauseRecognition();
    try {
      const response = await fetch("/api/ask-iris", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages.slice(-12), context: { language, section } }) });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || (language === "es" ? "IRIS no pudo completar el análisis." : "IRIS could not complete the analysis."));
      setSpokenAnswer(data.answer!);
      setMessages(current => [...current, { role: "assistant", content: data.answer! }]);
      if (autoSpeakRef.current || voiceStageRef.current) void speak(data.answer);
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", content: error instanceof Error ? error.message : (language === "es" ? "IRIS no está disponible temporalmente." : "IRIS is temporarily unavailable.") }]);
      if (voiceStageRef.current) resumeVoiceConversation();
    } finally { loadingRef.current = false; setLoading(false); }
  }

  function recognitionApi() {
    const speechWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  }

  function reportVoiceError(code: ReturnType<typeof mapRecognitionError>) {
    const message = voiceErrorMessage(code, language);
    if (!message) return;
    setVoiceHint(message);
    setMessages(current => current.some(item => item.content === message) ? current : [...current, { role: "assistant", content: message }]);
  }

  function commitSpokenQuestion(text: string) {
    const question = spokenQuestionFromTranscript(text);
    if (!question) return;
    transcriptBufferRef.current = "";
    clearVoiceTimers();
    setVoiceHint("");
    setLiveTranscript(question);
    setInput(question);
    void sendMessage(question);
  }

  function attachLevelMonitor(stream: MediaStream) {
    stopLevelMonitorRef.current?.();
    stopLevelMonitorRef.current = monitorMicrophoneLevel(stream, level => {
      const heard = isHearingVoice(level);
      if (heard !== hearingRef.current) {
        hearingRef.current = heard;
        setHearing(heard);
      }
      setVoiceEnergy(current => Math.abs(current - level) > 0.018 ? level : current);
    });
  }

  function beginRecognition() {
    if (!listenActiveRef.current || speakingRef.current || loadingRef.current) return;
    const RecognitionApi = recognitionApi();
    if (!RecognitionApi) { reportVoiceError("unsupported"); return; }
    recognitionRef.current?.abort();
    const recognition = new RecognitionApi();
    recognition.lang = recognitionLanguage(language);
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      let interim = "";
      let finals = "";
      for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript || "";
        if (result.isFinal) finals += `${text} `;
        else interim += text;
      }
      if (finals.trim()) {
        const combined = `${transcriptBufferRef.current} ${finals}`.replace(/\s+/g, " ").trim();
        transcriptBufferRef.current = combined;
        setInput(combined);
        setLiveTranscript(combined);
        setVoiceHint(language === "es" ? "Te oí. Sigue o espera, te pregunto a IRIS." : "I heard you. Keep going or wait and I will ask IRIS.");
        if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = window.setTimeout(() => {
          if (isStopCommand(transcriptBufferRef.current)) {
            transcriptBufferRef.current = "";
            closeVoiceStage();
            return;
          }
          commitSpokenQuestion(transcriptBufferRef.current);
        }, 900);
        return;
      }
      const live = `${transcriptBufferRef.current} ${interim}`.replace(/\s+/g, " ").trim();
      if (live) {
        setInput(live);
        setLiveTranscript(live);
        setVoiceHint(language === "es" ? "Te oigo…" : "I hear you…");
      }
    };
    recognition.onerror = event => {
      const code = mapRecognitionError(event.error || "unknown");
      if (isRetryableVoiceError(code)) return;
      if (code === "network") {
        recorderOnlyRef.current = true;
        recognition.abort();
        void startRecorderListening();
        return;
      }
      reportVoiceError(code);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (recorderOnlyRef.current) return;
      if (!listenActiveRef.current || speakingRef.current || loadingRef.current) {
        setListening(false);
        return;
      }
      setListening(true);
      restartTimerRef.current = window.setTimeout(beginRecognition, 220);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setVoiceHint(language === "es" ? "Te escucho. Habla ahora." : "Listening. Speak now.");
    } catch {
      recorderOnlyRef.current = true;
      void startRecorderListening();
    }
  }

  async function startListening() {
    unlockSpeechEngine();
    holdSpeechSession();
    openVoiceStage();
    setSpokenAnswer("");
    listenActiveRef.current = true;
    setListening(true);
    if (!greetedRef.current && autoSpeakRef.current) {
      greetedRef.current = true;
      const phrase = irisListenPhrase(language);
      setSpokenAnswer(phrase);
      setVoiceHint(language === "es" ? "IRIS te va a hablar." : "IRIS is about to speak.");
      await speak(phrase, { resume: false });
    }
    listenActiveRef.current = true;
    setListening(true);
    setVoiceHint(language === "es" ? "Abriendo el micrófono…" : "Opening the microphone…");
    try {
      if (!streamRef.current || streamRef.current.getTracks().every(track => track.readyState === "ended")) {
        releaseMicrophone(streamRef.current);
        streamRef.current = await openMicrophone();
      }
      attachLevelMonitor(streamRef.current);
    } catch (error) {
      listenActiveRef.current = false;
      reportVoiceError(mapMediaError(error));
      return;
    }
    if (recognitionApi() && !recorderOnlyRef.current) {
      beginRecognition();
      return;
    }
    if (!canRecordVoice()) {
      reportVoiceError("unknown");
      return;
    }
    void startRecorderListening();
  }

  async function startRecorderListening() {
    const stream = streamRef.current;
    if (!stream || !canRecordVoice()) {
      reportVoiceError("unknown");
      return;
    }
    recorderOnlyRef.current = true;
    setListening(true);
    setVoiceHint(language === "es" ? "Te escucho. Habla ahora." : "Listening. Speak now.");
    while (listenActiveRef.current && !speakingRef.current && !loadingRef.current) {
      const session = recordSpokenUtterance(stream, {
        isActive: () => listenActiveRef.current && !speakingRef.current && !loadingRef.current,
        isHearing: () => hearingRef.current,
      });
      recorderRef.current = session;
      const blob = await session.done;
      recorderRef.current = null;
      if (!listenActiveRef.current || speakingRef.current || loadingRef.current) return;
      if (!blob) {
        setVoiceHint(language === "es" ? "Sigo escuchando. Habla cerca del micrófono." : "Still listening. Speak near the microphone.");
        continue;
      }
      setVoiceHint(language === "es" ? "Convirtiendo lo que dijiste…" : "Turning your speech into text…");
      try {
        const text = await transcribeRecordedAudio(blob, language);
        if (isStopCommand(text)) {
          closeVoiceStage();
          return;
        }
        commitSpokenQuestion(text);
        return;
      } catch {
        setVoiceHint(language === "es" ? "No entendí eso. Habla otra vez, me quedo escuchando." : "I did not catch that. Speak again, I am still listening.");
      }
    }
  }
  startListeningRef.current = startListening;

  if (!open) return <button className="iris-chat-launcher" onClick={() => setOpen(true)}><ChatCircleDots weight="fill" /><span>Ask IRIS</span><i /></button>;

  return <aside className={`iris-chat ${voiceStage ? "voice-open" : ""}${fullScreen ? " full-screen" : ""}`} aria-label="Ask IRIS assistant">
    <header>
      <button onClick={() => setFullScreen(value => !value)} aria-label={fullScreen ? (language === "es" ? "Salir de pantalla completa" : "Exit full screen") : (language === "es" ? "Pantalla completa" : "Full screen")} title={fullScreen ? (language === "es" ? "Salir de pantalla completa" : "Exit full screen") : (language === "es" ? "Pantalla completa" : "Full screen")}>{fullScreen ? <CornersIn /> : <CornersOut />}</button>
      <button onClick={toggleAutoSpeak} aria-label={autoSpeak ? "Silenciar respuestas automáticas" : "Activar respuestas habladas"} title={autoSpeak ? "Silenciar" : "Activar voz"}>{autoSpeak ? <SpeakerHigh /> : <SpeakerSlash />}</button>
      <button onClick={() => { setFullScreen(false); closeVoiceStage(); stopVoice(); setOpen(false); }} aria-label="Close Ask IRIS"><X /></button>
    </header>
    {voiceStage
      ? <IrisVoiceStage language={language} mode={voiceMode} transcript={liveTranscript} answer={spokenAnswer} hearing={hearing} level={voiceEnergy} expanded={fullScreen} />
      : <div className="iris-chat-messages" aria-live="polite">{messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "IRIS" : (language === "es" ? "TÚ" : "YOU")}</span><p>{message.content}</p></article>)}{loading && <article className="assistant thinking"><span>IRIS</span><p><i /><i /><i /></p></article>}</div>}
    <div className="iris-chat-context">{language === "es" ? "Analizando" : "Analyzing"}: <strong>{section}</strong>{selectedIncident.id ? ` · ${selectedIncident.title || selectedIncident.id}` : ""}{voiceHint ? ` · ${voiceHint}` : ""}</div>
    <form className="iris-chat-input" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={language === "es" ? "Habla o escribe tu pregunta para IRIS…" : "Speak or type your question for IRIS…"} rows={2} /><button type="button" className={`iris-voice-command ${listening || voiceStage ? "listening" : ""}`} onClick={() => void startListening()} aria-label={language === "es" ? "Comando de voz" : "Voice command"} title={language === "es" ? "Comando de voz" : "Voice command"}><Microphone weight="fill" /></button><button type="submit" disabled={!input.trim() || loading} aria-label="Send question"><ArrowUp weight="bold" /></button></form>
  </aside>;
}
