"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChatCircleDots, CornersIn, CornersOut, Microphone, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import { holdSpeechSession, irisListenPhrase, isHearingVoice, isRetryableVoiceError, isStopCommand, mapRecognitionError, monitorMicrophoneLevel, openMicrophone, recognitionLanguage, releaseAudioForMicrophone, releaseMicrophone, resumeSpeechIfPaused, speakBrowserText, speechVolumeHint, spokenQuestionFromTranscript, stopSpeechEnginePlayback, unlockSpeechEngine, voiceErrorMessage } from "./iris-voice";
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
  const [welcomeKey, setWelcomeKey] = useState(`${language}:${userName}:${section}`);
  const nextWelcomeKey = `${language}:${userName}:${section}`;
  if (welcomeKey !== nextWelcomeKey) {
    setWelcomeKey(nextWelcomeKey);
    setMessages(current => current.length === 1 && current[0].role === "assistant" ? [welcomeMessage(language, userName, section)] : current);
  }
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voiceHint, setVoiceHint] = useState("");
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
  const queuedSpeechRef = useRef<string | null>(null);
  const speechSeqRef = useRef(0);
  const autoSpeakRef = useRef(true);
  autoSpeakRef.current = autoSpeak;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sendLockRef = useRef(false);
  const sendQueueRef = useRef<string[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  const voiceMode: VoiceStageMode = listening ? "listening" : loading || voiceLoading ? "thinking" : speaking ? "speaking" : "ready";

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

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, loading, voiceStage]);

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
    const seq = speechSeqRef.current;
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
          setVoiceHint(speechVolumeHint(language, { speaking: true, voices: Math.max(voices.length, window.speechSynthesis.getVoices().length) }));
        },
        onBlocked: () => {
          setVoiceHint(speechVolumeHint(language, { blocked: true, voices: window.speechSynthesis.getVoices().length }));
        },
        onEnd: () => {
          if (seq !== speechSeqRef.current) {
            resolve();
            return;
          }
          browserStopRef.current = null;
          stopSpeechKeepAlive();
          speakingRef.current = false;
          setSpeaking(false);
          setVoiceLoading(false);
          const queued = queuedSpeechRef.current;
          queuedSpeechRef.current = null;
          if (queued) {
            void browserVoiceFallback(queued, language === "es" ? "es" : detectedLanguage(queued)).then(resolve);
            return;
          }
          if (!skipResumeRef.current) resumeVoiceConversation();
          skipResumeRef.current = false;
          resolve();
        },
      });
    });
  }

  async function speak(text: string, options: { resume?: boolean } = {}) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    skipResumeRef.current = options.resume === false;
    unlockSpeechEngine();
    holdSpeechSession();
    releaseMicForSpeech();
    speechSeqRef.current += 1;
    queuedSpeechRef.current = null;
    browserStopRef.current?.();
    browserStopRef.current = null;
    await browserVoiceFallback(clean, language === "es" ? "es" : detectedLanguage(clean));
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

  function connectVoice(event?: { target?: EventTarget | null }) {
    const node = event?.target as HTMLElement | null;
    if (node?.closest("button, textarea, input, a")) return;
    unlockSpeechEngine();
    holdSpeechSession();
    if (greetedRef.current || !autoSpeakRef.current) return;
    greetedRef.current = true;
    const phrase = irisListenPhrase(language);
    setSpokenAnswer(phrase);
    setVoiceHint(language === "es" ? "IRIS te está hablando. Sube el volumen." : "IRIS is speaking. Turn the volume up.");
    void speak(phrase, { resume: false });
  }

  function onSpeakerClick() {
    unlockSpeechEngine();
    holdSpeechSession();
    if (speakingRef.current || voiceLoading) {
      setAutoSpeak(false);
      stopVoice();
      return;
    }
    setAutoSpeak(true);
    autoSpeakRef.current = true;
    const latest = spokenAnswer || messages.filter(item => item.role === "assistant").at(-1)?.content || irisListenPhrase(language);
    greetedRef.current = true;
    void speak(latest, { resume: false });
  }

  function stopVoice() { queuedSpeechRef.current = null; browserStopRef.current?.(); browserStopRef.current = null; stopSpeechEnginePlayback(); stopSpeechKeepAlive(); voiceRequestRef.current?.abort(); voiceRequestRef.current = null; audioRef.current?.pause(); audioRef.current = null; if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; } if ("speechSynthesis" in window) window.speechSynthesis.cancel(); speakingRef.current = false; setSpeaking(false); setVoiceLoading(false); }

  async function sendMessage(text = input) {
    unlockSpeechEngine();
    holdSpeechSession();
    const clean = text.trim();
    if (!clean) return;
    setInput("");
    if (sendLockRef.current) {
      sendQueueRef.current.push(clean);
      return;
    }
    sendLockRef.current = true;
    const nextMessages = [...messagesRef.current, { role: "user" as const, content: clean }];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    loadingRef.current = true;
    setLoading(true);
    pauseRecognition();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/ask-iris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-12), context: { language, section } }),
        signal: controller.signal,
      });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || (language === "es" ? "IRIS no pudo completar el análisis." : "IRIS could not complete the analysis."));
      const answer = data.answer;
      setSpokenAnswer(answer);
      const withReply = [...messagesRef.current, { role: "assistant" as const, content: answer }];
      messagesRef.current = withReply;
      setMessages(withReply);
      if (autoSpeakRef.current) void speak(answer);
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? (language === "es" ? "IRIS tardó demasiado. Pregúntame otra vez." : "IRIS took too long. Ask me again.")
        : error instanceof Error ? error.message : (language === "es" ? "IRIS no está disponible temporalmente." : "IRIS is temporarily unavailable.");
      setSpokenAnswer(message);
      const withReply = [...messagesRef.current, { role: "assistant" as const, content: message }];
      messagesRef.current = withReply;
      setMessages(withReply);
      if (autoSpeakRef.current) void speak(message);
    } finally {
      window.clearTimeout(timeout);
      loadingRef.current = false;
      setLoading(false);
      sendLockRef.current = false;
      const queued = sendQueueRef.current.shift();
      if (queued) void sendMessage(queued);
    }
  }

  function recognitionApi() {
    const speechWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  }

  function reportVoiceError(code: ReturnType<typeof mapRecognitionError>) {
    const message = voiceErrorMessage(code, language);
    if (!message) return;
    setVoiceHint(message);
    setMessages(current => {
      const next = current.some(item => item.content === message) ? current : [...current, { role: "assistant", content: message }];
      messagesRef.current = next;
      return next;
    });
  }

  function failVoiceConnect(code: ReturnType<typeof mapRecognitionError>) {
    listenActiveRef.current = false;
    closeVoiceStage();
    reportVoiceError(code);
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
      if (code === "denied" || code === "audio-capture") {
        failVoiceConnect(code);
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
    releaseAudioForMicrophone();
    unlockSpeechEngine();
    openVoiceStage();
    setSpokenAnswer("");
    listenActiveRef.current = true;
    setListening(false);
    setVoiceHint(language === "es" ? "Conectando el micrófono…" : "Connecting the microphone…");
    try {
      if (!streamRef.current || streamRef.current.getTracks().every(track => track.readyState === "ended")) {
        releaseMicrophone(streamRef.current);
        streamRef.current = await openMicrophone();
      }
      attachLevelMonitor(streamRef.current);
    } catch (error) {
      failVoiceConnect(mapMediaError(error));
      return;
    }
    if (!listenActiveRef.current) return;
    setListening(true);
    setVoiceHint(language === "es" ? "Te escucho. Habla ahora." : "Listening. Speak now.");
    if (!greetedRef.current && autoSpeakRef.current) {
      greetedRef.current = true;
      const phrase = irisListenPhrase(language);
      setSpokenAnswer(phrase);
      await speak(phrase, { resume: true });
      return;
    }
    if (recognitionApi() && !recorderOnlyRef.current) {
      beginRecognition();
      return;
    }
    if (!canRecordVoice()) {
      failVoiceConnect("unknown");
      return;
    }
    void startRecorderListening();
  }

  async function startRecorderListening() {
    const stream = streamRef.current;
    if (!stream || !canRecordVoice()) {
      failVoiceConnect("unknown");
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

  return <aside className={`iris-chat ${voiceStage ? "voice-open" : ""}${fullScreen ? " full-screen" : ""}`} aria-label="Ask IRIS assistant" onPointerDown={event => connectVoice(event)}>
    <header>
      <button onClick={() => setFullScreen(value => !value)} aria-label={fullScreen ? (language === "es" ? "Salir de pantalla completa" : "Exit full screen") : (language === "es" ? "Pantalla completa" : "Full screen")} title={fullScreen ? (language === "es" ? "Salir de pantalla completa" : "Exit full screen") : (language === "es" ? "Pantalla completa" : "Full screen")}>{fullScreen ? <CornersIn /> : <CornersOut />}</button>
      <button onClick={onSpeakerClick} aria-label={speaking || voiceLoading ? (language === "es" ? "Silenciar a IRIS" : "Mute IRIS") : (language === "es" ? "Conectar la voz de IRIS" : "Connect IRIS voice")} title={speaking || voiceLoading ? (language === "es" ? "Silenciar" : "Mute") : (language === "es" ? "Conectar voz" : "Connect voice")}>{autoSpeak ? <SpeakerHigh /> : <SpeakerSlash />}</button>
      <button onClick={() => { setFullScreen(false); closeVoiceStage(); stopVoice(); setOpen(false); }} aria-label="Close Ask IRIS"><X /></button>
    </header>
    {voiceStage ? <IrisVoiceStage language={language} mode={voiceMode} transcript={liveTranscript} answer={spokenAnswer} hearing={hearing} level={voiceEnergy} expanded={fullScreen} /> : null}
    <div className="iris-chat-messages" ref={listRef} aria-live="polite">{messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "IRIS" : (language === "es" ? "TÚ" : "YOU")}</span><p>{message.content}</p></article>)}{loading && <article className="assistant thinking"><span>IRIS</span><p><i /><i /><i /></p></article>}</div>
    <div className="iris-chat-context">{language === "es" ? "Analizando" : "Analyzing"}: <strong>{section}</strong>{selectedIncident.id ? ` · ${selectedIncident.title || selectedIncident.id}` : ""}{voiceHint ? ` · ${voiceHint}` : ""}</div>
    <form className="iris-chat-input" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={language === "es" ? "Habla o escribe tu pregunta para IRIS…" : "Speak or type your question for IRIS…"} rows={2} /><button type="button" className={`iris-voice-command ${listening || voiceStage ? "listening" : ""}`} onClick={() => void startListening()} aria-label={language === "es" ? "Comando de voz" : "Voice command"} title={language === "es" ? "Comando de voz" : "Voice command"}><Microphone weight="fill" /></button><button type="submit" disabled={!input.trim()} aria-label="Send question"><ArrowUp weight="bold" /></button></form>
  </aside>;
}
