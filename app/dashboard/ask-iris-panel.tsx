"use client";

import { useState } from "react";
import { ArrowUp, ChatCircleDots, Microphone, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";

type ChatMessage = { role: "user" | "assistant"; content: string };
type IncidentContext = { id: string; title: string; subject: string; severity: string; status: string; source: string; evidence: string[]; recommendation: string };

const welcomeMessage = (language: Language): ChatMessage => ({ role: "assistant", content: language === "es" ? "Hola. Soy IRIS. Puedo analizar los incidentes, la inteligencia, las aprobaciones y el registro de auditoría de este sistema. ¿Qué deseas investigar?" : "Hello. I am IRIS. I can analyze the incidents, intelligence, approvals, and audit log shown in this system. What would you like to investigate?" });

export default function AskIrisPanel({ section, selectedIncident, incidents, userRole, language }: { section: string; selectedIncident: IncidentContext; incidents: IncidentContext[]; userRole: string; language: Language }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage(language)]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "es" ? "es-US" : "en-US";
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage(text = input) {
    const clean = text.trim();
    if (!clean || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content: clean }];
    setMessages(nextMessages); setInput(""); setLoading(true);
    try {
      const response = await fetch("/api/ask-iris", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages.slice(-12), context: { language, section, userRole, selectedIncident, incidents: incidents.map(({ id, title, subject, severity, status, source }) => ({ id, title, subject, severity, status, source })) } }) });
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
    <header><div className="iris-chat-orb"><ChatCircleDots weight="duotone" /></div><div><strong>Ask IRIS</strong><span><i /> OpenAI {language === "es" ? "conectado" : "connected"} · {section}</span></div><button onClick={() => setAutoSpeak(value => !value)} aria-label={autoSpeak ? "Disable spoken responses" : "Enable spoken responses"}>{autoSpeak ? <SpeakerHigh /> : <SpeakerSlash />}</button><button onClick={() => setOpen(false)} aria-label="Close Ask IRIS"><X /></button></header>
    <div className="iris-chat-messages" aria-live="polite">{messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "IRIS" : (language === "es" ? "TÚ" : "YOU")}</span><p>{message.content}</p>{message.role === "assistant" && <button onClick={() => speak(message.content)} aria-label="Read this answer aloud"><SpeakerHigh /></button>}</article>)}{loading && <article className="assistant thinking"><span>IRIS</span><p><i /><i /><i /></p></article>}</div>
    <div className="iris-chat-context">{language === "es" ? "Analizando" : "Analyzing"}: <strong>{section}</strong> · {selectedIncident.id}</div>
    <form className="iris-chat-input" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={language === "es" ? "Escribe tu pregunta para IRIS…" : "Type your question for IRIS…"} rows={2} /><button type="button" className={listening ? "listening" : ""} onClick={startListening} aria-label="Ask with microphone"><Microphone weight="fill" /></button><button type="submit" disabled={!input.trim() || loading} aria-label="Send question"><ArrowUp weight="bold" /></button></form>
  </aside>;
}
