"use client";

import { useState } from "react";
import { ArrowUp, ChatCircleDots, Microphone, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";

type ChatMessage = { role: "user" | "assistant"; content: string };
type IncidentContext = { id: string; title: string; subject: string; severity: string; status: string; source: string; evidence: string[]; recommendation: string };

const welcomeMessage: ChatMessage = { role: "assistant", content: "Hola. Soy IRIS. Puedo analizar los incidentes, la inteligencia y el registro de auditoría que aparecen en este sistema. ¿Qué deseas investigar?" };

export default function AskIrisPanel({ section, selectedIncident, incidents, userRole }: { section: string; selectedIncident: IncidentContext; incidents: IncidentContext[]; userRole: string }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-US";
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage(text = input) {
    const clean = text.trim();
    if (!clean || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content: clean }];
    setMessages(nextMessages); setInput(""); setLoading(true);
    try {
      const response = await fetch("/api/ask-iris", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages.slice(-12), context: { section, userRole, selectedIncident, incidents: incidents.map(({ id, title, subject, severity, status, source }) => ({ id, title, subject, severity, status, source })) } }) });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || "IRIS could not complete the analysis.");
      setMessages(current => [...current, { role: "assistant", content: data.answer! }]);
      if (autoSpeak) speak(data.answer);
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", content: error instanceof Error ? error.message : "IRIS is temporarily unavailable." }]);
    } finally { setLoading(false); }
  }

  function startListening() {
    type Recognition = new () => { lang: string; start(): void; onend: () => void; onerror: () => void; onresult: (event: { results: { 0: { 0: { transcript: string } } }[] }) => void };
    const speechWindow = window as unknown as { SpeechRecognition?: Recognition; webkitSpeechRecognition?: Recognition };
    const RecognitionApi = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!RecognitionApi) { setMessages(current => [...current, { role: "assistant", content: "Este navegador no ofrece entrada de voz. Puedes escribir tu pregunta." }]); return; }
    const recognition = new RecognitionApi(); recognition.lang = "es-US"; setListening(true);
    recognition.onend = () => setListening(false); recognition.onerror = () => setListening(false);
    recognition.onresult = event => { const transcript = event.results[0][0].transcript; setInput(transcript); void sendMessage(transcript); };
    recognition.start();
  }

  if (!open) return <button className="iris-chat-launcher" onClick={() => setOpen(true)}><ChatCircleDots weight="fill" /><span>Ask IRIS</span><i /></button>;

  return <aside className="iris-chat" aria-label="Ask IRIS assistant">
    <header><div className="iris-chat-orb"><ChatCircleDots weight="duotone" /></div><div><strong>Ask IRIS</strong><span><i /> OpenAI connected · {section}</span></div><button onClick={() => setAutoSpeak(value => !value)} aria-label={autoSpeak ? "Disable spoken responses" : "Enable spoken responses"}>{autoSpeak ? <SpeakerHigh /> : <SpeakerSlash />}</button><button onClick={() => setOpen(false)} aria-label="Close Ask IRIS"><X /></button></header>
    <div className="iris-chat-messages" aria-live="polite">{messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "IRIS" : "YOU"}</span><p>{message.content}</p>{message.role === "assistant" && <button onClick={() => speak(message.content)} aria-label="Read this answer aloud"><SpeakerHigh /></button>}</article>)}{loading && <article className="assistant thinking"><span>IRIS</span><p><i /><i /><i /></p></article>}</div>
    <div className="iris-chat-context">Analyzing: <strong>{section}</strong> · {selectedIncident.id}</div>
    <form className="iris-chat-input" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Escribe tu pregunta para IRIS…" rows={2} /><button type="button" className={listening ? "listening" : ""} onClick={startListening} aria-label="Ask with microphone"><Microphone weight="fill" /></button><button type="submit" disabled={!input.trim() || loading} aria-label="Send question"><ArrowUp weight="bold" /></button></form>
  </aside>;
}
