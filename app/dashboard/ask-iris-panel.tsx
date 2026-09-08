"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChatCircleDots, Microphone, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import { mapRecognitionError, recognitionLanguage, requestMicrophone, voiceErrorMessage } from "./iris-voice";
import IrisVoiceStage, { type VoiceStageMode } from "./iris-voice-stage";

type ChatMessage = { role: "user" | "assistant"; content: string };
type IncidentContext = { id: string; title: string; subject: string; severity: string; status: string; source: string; evidence: string[]; recommendation: string };
type DeviceContext = { id: string; name: string; platform: string; status: string; risk: string; lastSeenAt: string | null; telemetry?: string };
type SpeechResultEvent = { resultIndex?: number; results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }> };
type RecognitionInstance = { lang: string; continuous?: boolean; interimResults?: boolean; start(): void; stop(): void; abort(): void; onend: (() => void) | null; onerror: ((event: { error?: string }) => void) | null; onresult: ((event: SpeechResultEvent) => void) | null };
type RecognitionConstructor = new () => RecognitionInstance;

const welcomeMessage = (language: Language, userName: string): ChatMessage => ({ role: "assistant", content: language === "es" ? `Hola, ${userName}. Soy IRIS. Estoy lista para revisar contigo lo que ocurre en el sistema. Puedes preguntarme con tus propias palabras.` : `Hi, ${userName}. I'm IRIS. I'm ready to review what's happening in the system with you. Ask me anything in your own words.` });

export default function AskIrisPanel({ section, selectedIncident, userName, language }: { section: string; selectedIncident: IncidentContext; incidents: IncidentContext[]; devices: DeviceContext[]; userRole: string; userName: string; language: Language }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage(language, userName)]);
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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const speakingRef = useRef(false);
  const voiceStageRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const voiceRequestRef = useRef<AbortController | null>(null);
  const startListeningRef = useRef<() => Promise<void>>(async () => undefined);

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

  useEffect(() => () => { voiceRequestRef.current?.abort(); audioRef.current?.pause(); if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); }, []);

  function detectedLanguage(text: string) {
    const spanishSignals = /[áéíóúñ¿¡]|\b(hola|gracias|puedes|quiero|seguridad|amenaza|aplicaciones|equipo|sistema|porque|cómo|qué)\b/i;
    return spanishSignals.test(text) ? "es" : "en";
  }

  function browserVoiceFallback(text: string) {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const spokenLanguage = detectedLanguage(text);
    utterance.lang = spokenLanguage === "es" ? "es-US" : "en-US";
    const locale = spokenLanguage === "es" ? /^es([_-]|$)/i : /^en([_-]|$)/i;
    const preferred = voices.filter(voice => locale.test(voice.lang)).sort((a, b) => {
      const quality = (voice: SpeechSynthesisVoice) => /premium|enhanced|natural|neural|siri|google|ava|samantha|paulina|m[oó]nica/i.test(voice.name) ? 3 : voice.localService ? 2 : 1;
      return quality(b) - quality(a);
    })[0];
    if (preferred) utterance.voice = preferred;
    utterance.rate = 0.94; utterance.pitch = 1.01; utterance.volume = 1;
    utterance.onstart = () => { speakingRef.current = true; setSpeaking(true); };
    utterance.onend = () => { speakingRef.current = false; setSpeaking(false); resumeVoiceConversation(); };
    utterance.onerror = () => { speakingRef.current = false; setSpeaking(false); resumeVoiceConversation(); };
    window.speechSynthesis.speak(utterance);
  }

  async function speak(text: string) {
    stopVoice();
    if (neuralVoice === false) { browserVoiceFallback(text); return; }
    const controller = new AbortController(); voiceRequestRef.current = controller; setVoiceLoading(true);
    try {
      const response = await fetch("/api/iris-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language: detectedLanguage(text) }), signal: controller.signal });
      if (!response.ok) throw new Error("voice unavailable");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); audioUrlRef.current = url;
      const audio = new Audio(url); audioRef.current = audio;
      audio.onplay = () => { speakingRef.current = true; setSpeaking(true); setVoiceLoading(false); };
      audio.onended = () => finishNeuralVoice();
      audio.onerror = () => { finishNeuralVoice(); browserVoiceFallback(text); };
      await audio.play();
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      finishNeuralVoice();
      if (!aborted) browserVoiceFallback(text);
    }
  }

  function resumeVoiceConversation() {
    if (voiceStageRef.current && !loading) setTimeout(() => void startListeningRef.current(), 500);
  }

  function finishNeuralVoice() {
    voiceRequestRef.current = null; speakingRef.current = false; setSpeaking(false); setVoiceLoading(false); audioRef.current = null;
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
    resumeVoiceConversation();
  }

  function openVoiceStage() {
    voiceStageRef.current = true;
    setVoiceStage(true);
    setAutoSpeak(true);
    setOpen(true);
  }

  function closeVoiceStage() {
    voiceStageRef.current = false;
    setVoiceStage(false);
    setListening(false);
    setLiveTranscript("");
    stopVoice();
  }

  function stopVoice() { voiceRequestRef.current?.abort(); voiceRequestRef.current = null; audioRef.current?.pause(); audioRef.current = null; if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; } if ("speechSynthesis" in window) window.speechSynthesis.cancel(); speakingRef.current = false; setSpeaking(false); setVoiceLoading(false); }
  function toggleAutoSpeak() { setAutoSpeak(value => { const next = !value; if (!next) stopVoice(); return next; }); }

  async function sendMessage(text = input) {
    const clean = text.trim();
    if (!clean || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content: clean }];
    setMessages(nextMessages); setInput(""); setLoading(true);
    try {
      const response = await fetch("/api/ask-iris", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages.slice(-12), context: { language, section } }) });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || (language === "es" ? "IRIS no pudo completar el análisis." : "IRIS could not complete the analysis."));
      setSpokenAnswer(data.answer!);
      setMessages(current => [...current, { role: "assistant", content: data.answer! }]);
      if (autoSpeak || voiceStageRef.current) void speak(data.answer);
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", content: error instanceof Error ? error.message : (language === "es" ? "IRIS no está disponible temporalmente." : "IRIS is temporarily unavailable.") }]);
    } finally { setLoading(false); }
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

  async function startListening() {
    openVoiceStage();
    setSpokenAnswer("");
    const RecognitionApi = recognitionApi();
    if (!RecognitionApi) { setListening(true); reportVoiceError("unsupported"); return; }
    try {
      await requestMicrophone();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setListening(true);
      reportVoiceError(name === "NotAllowedError" ? "denied" : name === "NotFoundError" ? "audio-capture" : "unsupported");
      return;
    }
    const recognition = new RecognitionApi();
    recognition.lang = recognitionLanguage(language);
    recognition.interimResults = true;
    setListening(true); setVoiceHint(language === "es" ? "Te escucho…" : "Listening…");
    recognition.onend = () => setListening(false);
    recognition.onerror = event => { setListening(false); reportVoiceError(mapRecognitionError(event.error || "unknown")); };
    recognition.onresult = event => {
      const last = event.results[event.results.length - 1];
      const transcript = last?.[0]?.transcript || "";
      setInput(transcript);
      setLiveTranscript(transcript);
      if (!last?.isFinal) return;
      setVoiceHint("");
      void sendMessage(transcript);
    };
    try { recognition.start(); } catch { setListening(false); reportVoiceError("unknown"); }
  }
  startListeningRef.current = startListening;

  if (!open) return <button className="iris-chat-launcher" onClick={() => setOpen(true)}><ChatCircleDots weight="fill" /><span>Ask IRIS</span><i /></button>;

  return <aside className={`iris-chat ${voiceStage ? "voice-open" : ""}`} aria-label="Ask IRIS assistant">
    <header><div className={`iris-avatar ${speaking ? "speaking" : ""} ${listening ? "listening" : ""}`} aria-label={speaking ? (language === "es" ? "IRIS está hablando" : "IRIS is speaking") : listening ? (language === "es" ? "IRIS está escuchando" : "IRIS is listening") : "IRIS"}><img src="/assets/iris-avatar.webp" alt="Avatar de IRIS" width="54" height="54" /><span className="iris-avatar-mouth" /></div><div><strong>Ask IRIS</strong><span><i /> {voiceLoading ? (language === "es" ? "Preparando voz" : "Preparing voice") : speaking ? (language === "es" ? "Hablando · di Para" : "Speaking · say Stop") : listening ? (language === "es" ? "Escuchando" : "Listening") : (language === "es" ? "Lista para ayudarte" : "Ready to help")}</span><small>{language === "es" ? "Voz neuronal generada por IA" : "AI-generated neural voice"}</small></div><button onClick={toggleAutoSpeak} aria-label={autoSpeak ? "Silenciar respuestas automáticas" : "Activar respuestas habladas"} title={autoSpeak ? "Silenciar" : "Activar voz"}>{autoSpeak ? <SpeakerHigh /> : <SpeakerSlash />}</button><button onClick={() => { closeVoiceStage(); stopVoice(); setOpen(false); }} aria-label="Close Ask IRIS"><X /></button></header>
    {voiceStage
      ? <IrisVoiceStage language={language} mode={voiceMode} transcript={liveTranscript} answer={spokenAnswer} onClose={closeVoiceStage} />
      : <div className="iris-chat-messages" aria-live="polite">{messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "IRIS" : (language === "es" ? "TÚ" : "YOU")}</span><p>{message.content}</p>{message.role === "assistant" && <button onClick={() => void speak(message.content)} aria-label="Read this answer aloud"><SpeakerHigh /></button>}</article>)}{loading && <article className="assistant thinking"><span>IRIS</span><p><i /><i /><i /></p></article>}</div>}
    <div className="iris-chat-context">{language === "es" ? "Analizando" : "Analyzing"}: <strong>{section}</strong> · {selectedIncident.id}{voiceHint ? ` · ${voiceHint}` : ""}</div>
    <form className="iris-chat-input" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={language === "es" ? "Habla o escribe tu pregunta para IRIS…" : "Speak or type your question for IRIS…"} rows={2} /><button type="button" className={`iris-voice-command ${listening || voiceStage ? "listening" : ""}`} onClick={() => void startListening()} aria-label={language === "es" ? "Comando de voz" : "Voice command"} title={language === "es" ? "Comando de voz" : "Voice command"}><Microphone weight="fill" /></button><button type="submit" disabled={!input.trim() || loading} aria-label="Send question"><ArrowUp weight="bold" /></button></form>
  </aside>;
}
