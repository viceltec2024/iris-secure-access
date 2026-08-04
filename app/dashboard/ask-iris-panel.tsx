"use client";

import { useEffect, useState } from "react";
import { ArrowUp, ChatCircleDots, Microphone, Pause, Play, SpeakerHigh, SpeakerLow, SpeakerSlash, Stop, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";

type ChatMessage = { role: "user" | "assistant"; content: string };
type IncidentContext = { id: string; title: string; subject: string; severity: string; status: string; source: string; evidence: string[]; recommendation: string };
type DeviceContext = { id: string; name: string; platform: string; status: string; risk: string; lastSeenAt: string | null; telemetry?: string };

const welcomeMessage = (language: Language, userName: string): ChatMessage => ({ role: "assistant", content: language === "es" ? `Hola, ${userName}. Soy IRIS. Estoy lista para revisar contigo lo que ocurre en el sistema. Puedes preguntarme con tus propias palabras.` : `Hi, ${userName}. I'm IRIS. I'm ready to review what's happening in the system with you. Ask me anything in your own words.` });

export default function AskIrisPanel({ section, selectedIncident, incidents, devices, userRole, userName, language }: { section: string; selectedIncident: IncidentContext; incidents: IncidentContext[]; devices: DeviceContext[]; userRole: string; userName: string; language: Language }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage(language, userName)]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refreshVoices = () => setVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    return () => { window.speechSynthesis.cancel(); window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices); };
  }, []);

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "es" ? "es-US" : "en-US";
    const locale = language === "es" ? /^es([_-]|$)/i : /^en([_-]|$)/i;
    const preferred = voices.filter(voice => locale.test(voice.lang)).sort((a, b) => {
      const quality = (voice: SpeechSynthesisVoice) => /premium|enhanced|natural|neural|siri|google/i.test(voice.name) ? 2 : voice.localService ? 1 : 0;
      return quality(b) - quality(a);
    })[0];
    if (preferred) utterance.voice = preferred;
    utterance.rate = 0.96; utterance.pitch = 1.02; utterance.volume = volume;
    utterance.onstart = () => { setSpeaking(true); setPaused(false); };
    utterance.onend = () => { setSpeaking(false); setPaused(false); };
    utterance.onerror = () => { setSpeaking(false); setPaused(false); };
    window.speechSynthesis.speak(utterance);
  }

  function stopVoice() { if (!("speechSynthesis" in window)) return; window.speechSynthesis.cancel(); setSpeaking(false); setPaused(false); }
  function togglePause() { if (!("speechSynthesis" in window) || !speaking) return; if (paused) window.speechSynthesis.resume(); else window.speechSynthesis.pause(); setPaused(value => !value); }
  function toggleAutoSpeak() { setAutoSpeak(value => { const next = !value; if (!next) stopVoice(); return next; }); }

  async function sendMessage(text = input) {
    const clean = text.trim();
    if (!clean || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content: clean }];
    setMessages(nextMessages); setInput(""); setLoading(true);
    try {
      const response = await fetch("/api/ask-iris", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages.slice(-12), context: { language, section, userRole, userName, selectedIncident, incidents: incidents.map(({ id, title, subject, severity, status, source }) => ({ id, title, subject, severity, status, source })), devices: devices.map(({ id, name, platform, status, risk, lastSeenAt, telemetry }) => ({ id, name, platform, status, risk, lastSeenAt, telemetry })) } }) });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || (language === "es" ? "IRIS no pudo completar el análisis." : "IRIS could not complete the analysis."));
      setMessages(current => [...current, { role: "assistant", content: data.answer! }]);
      if (autoSpeak) speak(data.answer);
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", content: error instanceof Error ? error.message : (language === "es" ? "IRIS no está disponible temporalmente." : "IRIS is temporarily unavailable.") }]);
    } finally { setLoading(false); }
  }

  function startListening() {
    type Recognition = new () => { lang: string; start(): void; onend: () => void; onerror: () => void; onresult: (event: { results: { 0: { 0: { transcript: string } } }[] }) => void };
    const speechWindow = window as unknown as { SpeechRecognition?: Recognition; webkitSpeechRecognition?: Recognition };
    const RecognitionApi = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!RecognitionApi) { setMessages(current => [...current, { role: "assistant", content: language === "es" ? "Este navegador no ofrece entrada de voz. Puedes escribir tu pregunta." : "This browser does not support voice input. You can type your question." }]); return; }
    const recognition = new RecognitionApi(); recognition.lang = language === "es" ? "es-US" : "en-US"; setListening(true);
    recognition.onend = () => setListening(false); recognition.onerror = () => setListening(false);
    recognition.onresult = event => { const transcript = event.results[0][0].transcript; setInput(transcript); void sendMessage(transcript); };
    recognition.start();
  }

  if (!open) return <button className="iris-chat-launcher" onClick={() => setOpen(true)}><ChatCircleDots weight="fill" /><span>Ask IRIS</span><i /></button>;

  return <aside className="iris-chat" aria-label="Ask IRIS assistant">
    <header><div className="iris-chat-orb"><ChatCircleDots weight="duotone" /></div><div><strong>Ask IRIS</strong><span><i /> OpenAI {language === "es" ? "conectado" : "connected"} · {section}</span></div><button onClick={toggleAutoSpeak} aria-label={autoSpeak ? "Silenciar respuestas automáticas" : "Activar respuestas habladas"} title={autoSpeak ? "Silenciar" : "Activar voz"}>{autoSpeak ? <SpeakerHigh /> : <SpeakerSlash />}</button><button onClick={() => { stopVoice(); setOpen(false); }} aria-label="Close Ask IRIS"><X /></button></header>
    <div className="iris-voice-controls" aria-label={language === "es" ? "Controles de voz" : "Voice controls"}>
      <button onClick={togglePause} disabled={!speaking} aria-label={paused ? "Continuar voz" : "Pausar voz"} title={paused ? "Continuar" : "Pausar"}>{paused ? <Play weight="fill" /> : <Pause weight="fill" />}</button>
      <button onClick={stopVoice} disabled={!speaking} aria-label="Detener voz" title="Detener"><Stop weight="fill" /></button>
      <SpeakerLow aria-hidden="true" /><input type="range" min="0" max="1" step="0.05" value={volume} onChange={event => setVolume(Number(event.target.value))} aria-label={language === "es" ? "Volumen de IRIS" : "IRIS volume"} /><SpeakerHigh aria-hidden="true" />
      <span>{Math.round(volume * 100)}%</span>
    </div>
    <div className="iris-chat-messages" aria-live="polite">{messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "IRIS" : (language === "es" ? "TÚ" : "YOU")}</span><p>{message.content}</p>{message.role === "assistant" && <button onClick={() => speak(message.content)} aria-label="Read this answer aloud"><SpeakerHigh /></button>}</article>)}{loading && <article className="assistant thinking"><span>IRIS</span><p><i /><i /><i /></p></article>}</div>
    <div className="iris-chat-context">{language === "es" ? "Analizando" : "Analyzing"}: <strong>{section}</strong> · {selectedIncident.id}</div>
    <form className="iris-chat-input" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={language === "es" ? "Escribe tu pregunta para IRIS…" : "Type your question for IRIS…"} rows={2} /><button type="button" className={listening ? "listening" : ""} onClick={startListening} aria-label="Ask with microphone"><Microphone weight="fill" /></button><button type="submit" disabled={!input.trim() || loading} aria-label="Send question"><ArrowUp weight="bold" /></button></form>
  </aside>;
}
