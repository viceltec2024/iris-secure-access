"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChatCircleDots, Microphone, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";

type ChatMessage = { role: "user" | "assistant"; content: string };
type IncidentContext = { id: string; title: string; subject: string; severity: string; status: string; source: string; evidence: string[]; recommendation: string };
type DeviceContext = { id: string; name: string; platform: string; status: string; risk: string; lastSeenAt: string | null; telemetry?: string };
type SpeechResultEvent = { resultIndex?: number; results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }> };
type RecognitionInstance = { lang: string; continuous?: boolean; interimResults?: boolean; start(): void; stop(): void; abort(): void; onend: (() => void) | null; onerror: (() => void) | null; onresult: ((event: SpeechResultEvent) => void) | null };
type RecognitionConstructor = new () => RecognitionInstance;

const welcomeMessage = (language: Language, userName: string): ChatMessage => ({ role: "assistant", content: language === "es" ? `Hola, ${userName}. Soy IRIS. Estoy lista para revisar contigo lo que ocurre en el sistema. Puedes preguntarme con tus propias palabras.` : `Hi, ${userName}. I'm IRIS. I'm ready to review what's happening in the system with you. Ask me anything in your own words.` });

export default function AskIrisPanel({ section, selectedIncident, userName, language }: { section: string; selectedIncident: IncidentContext; incidents: IncidentContext[]; devices: DeviceContext[]; userRole: string; userName: string; language: Language }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage(language, userName)]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [handsFree, setHandsFree] = useState(false);
  const [wakeHeard, setWakeHeard] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const wakeRecognitionRef = useRef<RecognitionInstance | null>(null);
  const handsFreeRef = useRef(false);
  const speakingRef = useRef(false);
  const sendMessageRef = useRef<(text: string) => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refreshVoices = () => setVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    return () => { window.speechSynthesis.cancel(); window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices); };
  }, []);

  useEffect(() => () => { handsFreeRef.current = false; wakeRecognitionRef.current?.abort(); }, []);

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const spanishSignals = /[áéíóúñ¿¡]|\b(hola|gracias|puedes|quiero|seguridad|amenaza|aplicaciones|equipo|sistema|porque|cómo|qué)\b/i;
    const spokenLanguage = spanishSignals.test(text) ? "es" : "en";
    utterance.lang = spokenLanguage === "es" ? "es-US" : "en-US";
    const locale = spokenLanguage === "es" ? /^es([_-]|$)/i : /^en([_-]|$)/i;
    const preferred = voices.filter(voice => locale.test(voice.lang)).sort((a, b) => {
      const quality = (voice: SpeechSynthesisVoice) => /premium|enhanced|natural|neural|siri|google|ava|samantha|paulina|m[oó]nica/i.test(voice.name) ? 3 : voice.localService ? 2 : 1;
      return quality(b) - quality(a);
    })[0];
    if (preferred) utterance.voice = preferred;
    utterance.rate = 0.94; utterance.pitch = 1.01; utterance.volume = 1;
    utterance.onstart = () => { speakingRef.current = true; setSpeaking(true); if (handsFreeRef.current) setTimeout(startWakeRecognition, 150); };
    utterance.onend = () => { speakingRef.current = false; setSpeaking(false); if (handsFreeRef.current) setTimeout(startWakeRecognition, 450); };
    utterance.onerror = () => { speakingRef.current = false; setSpeaking(false); if (handsFreeRef.current) setTimeout(startWakeRecognition, 450); };
    window.speechSynthesis.speak(utterance);
  }

  function stopVoice() { if (!("speechSynthesis" in window)) return; window.speechSynthesis.cancel(); speakingRef.current = false; setSpeaking(false); }
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
      setMessages(current => [...current, { role: "assistant", content: data.answer! }]);
      if (autoSpeak) speak(data.answer);
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", content: error instanceof Error ? error.message : (language === "es" ? "IRIS no está disponible temporalmente." : "IRIS is temporarily unavailable.") }]);
    } finally { setLoading(false); }
  }
  sendMessageRef.current = sendMessage;

  function recognitionApi() {
    const speechWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  }

  function startWakeRecognition() {
    if (!handsFreeRef.current || wakeRecognitionRef.current) return;
    const RecognitionApi = recognitionApi();
    if (!RecognitionApi) return;
    const recognition = new RecognitionApi();
    recognition.lang = language === "es" ? "es-US" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = event => {
      for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript?.trim() || "";
        const normalized = transcript.toLocaleLowerCase().replace(/[.,!?¿¡;:]/g, " ").replace(/\s+/g, " ").trim();
        const shortCommand = normalized.split(" ").length <= 4;
        const stopCommand = /^(?:stop|para|p[aá]rate|detente|silencio|c[aá]llate|quiet|cancel)(?:\s+iris)?$/.test(normalized);
        if (speakingRef.current && shortCommand && stopCommand) {
          stopVoice(); setWakeHeard(true); setListening(false);
          setTimeout(() => setWakeHeard(false), 700);
          continue;
        }
        const wakeMatch = transcript.match(/(?:oye|hey|ok)\s+iris\b/i);
        if (!wakeMatch) continue;
        const command = transcript.slice((wakeMatch.index || 0) + wakeMatch[0].length).replace(/^[,.:;\s]+/, "").trim();
        const question = command || (language === "es" ? "¿Cuál es el estado completo del sistema y dónde están las amenazas detectadas?" : "What is the complete system status and where are the detected threats?");
        setWakeHeard(true); setOpen(true); setListening(true);
        recognition.abort();
        setTimeout(() => { setWakeHeard(false); setListening(false); }, 1200);
        void sendMessageRef.current(question);
        break;
      }
    };
    recognition.onerror = () => { wakeRecognitionRef.current = null; };
    recognition.onend = () => { wakeRecognitionRef.current = null; if (handsFreeRef.current && !speakingRef.current) setTimeout(startWakeRecognition, 700); };
    wakeRecognitionRef.current = recognition;
    try { recognition.start(); } catch { wakeRecognitionRef.current = null; }
  }

  function toggleHandsFree() {
    const next = !handsFreeRef.current;
    handsFreeRef.current = next; setHandsFree(next);
    if (next) {
      startWakeRecognition();
      setMessages(current => [...current, { role: "assistant", content: language === "es" ? "Modo manos libres activado. Di “Oye IRIS” y después tu pregunta. Mientras esta página permanezca abierta, no necesitas tocar ningún botón." : "Hands-free mode is on. Say “Hey IRIS,” followed by your question. While this page remains open, you do not need to touch any button." }]);
    } else {
      wakeRecognitionRef.current?.abort(); wakeRecognitionRef.current = null;
    }
  }

  function startListening() {
    const RecognitionApi = recognitionApi();
    if (!RecognitionApi) { setMessages(current => [...current, { role: "assistant", content: language === "es" ? "Este navegador no ofrece entrada de voz. Puedes escribir tu pregunta." : "This browser does not support voice input. You can type your question." }]); return; }
    const recognition = new RecognitionApi(); recognition.lang = language === "es" ? "es-US" : "en-US"; setListening(true);
    recognition.onend = () => setListening(false); recognition.onerror = () => setListening(false);
    recognition.onresult = event => { const transcript = event.results[0][0].transcript; setInput(transcript); void sendMessage(transcript); };
    recognition.start();
  }

  if (!open) return <button className="iris-chat-launcher" onClick={() => setOpen(true)}><ChatCircleDots weight="fill" /><span>Ask IRIS</span><i /></button>;

  return <aside className="iris-chat" aria-label="Ask IRIS assistant">
    <header><div className={`iris-avatar ${speaking ? "speaking" : ""} ${listening ? "listening" : ""}`} aria-label={speaking ? (language === "es" ? "IRIS está hablando" : "IRIS is speaking") : listening ? (language === "es" ? "IRIS está escuchando" : "IRIS is listening") : "IRIS"}><img src="/assets/iris-avatar.webp" alt="Avatar de IRIS" width="54" height="54" /><span className="iris-avatar-mouth" /></div><div><strong>Ask IRIS</strong><span><i /> {speaking ? (language === "es" ? "Hablando · di Para" : "Speaking · say Stop") : listening ? (language === "es" ? "Escuchando" : "Listening") : (language === "es" ? "Lista para ayudarte" : "Ready to help")}</span><small>ES · EN {language === "es" ? "automático" : "automatic"}</small></div><button onClick={toggleAutoSpeak} aria-label={autoSpeak ? "Silenciar respuestas automáticas" : "Activar respuestas habladas"} title={autoSpeak ? "Silenciar" : "Activar voz"}>{autoSpeak ? <SpeakerHigh /> : <SpeakerSlash />}</button><button onClick={() => { stopVoice(); setOpen(false); }} aria-label="Close Ask IRIS"><X /></button></header>
    <div className="iris-chat-messages" aria-live="polite">{messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "IRIS" : (language === "es" ? "TÚ" : "YOU")}</span><p>{message.content}</p>{message.role === "assistant" && <button onClick={() => speak(message.content)} aria-label="Read this answer aloud"><SpeakerHigh /></button>}</article>)}{loading && <article className="assistant thinking"><span>IRIS</span><p><i /><i /><i /></p></article>}</div>
    <button type="button" className={`iris-wake-mode ${handsFree ? "active" : ""} ${wakeHeard ? "heard" : ""}`} onClick={toggleHandsFree} aria-pressed={handsFree}><Microphone weight="fill" /><span><strong>{handsFree ? (language === "es" ? "Oye IRIS · ACTIVO" : "Hey IRIS · ON") : (language === "es" ? "Activar Oye IRIS" : "Enable Hey IRIS")}</strong><small>{handsFree ? (language === "es" ? "Escuchando la frase de activación" : "Listening for the wake phrase") : (language === "es" ? "Control por voz sin tocar teclas" : "Hands-free voice control")}</small></span><i /></button>
    <div className="iris-chat-context">{language === "es" ? "Analizando" : "Analyzing"}: <strong>{section}</strong> · {selectedIncident.id}</div>
    <form className="iris-chat-input" onSubmit={event => { event.preventDefault(); void sendMessage(); }}><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={language === "es" ? "Escribe tu pregunta para IRIS…" : "Type your question for IRIS…"} rows={2} /><button type="button" className={listening ? "listening" : ""} onClick={startListening} aria-label="Ask with microphone"><Microphone weight="fill" /></button><button type="submit" disabled={!input.trim() || loading} aria-label="Send question"><ArrowUp weight="bold" /></button></form>
  </aside>;
}
