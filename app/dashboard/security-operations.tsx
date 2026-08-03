"use client";

import { useMemo, useState } from "react";
import { Bell, ChartLineUp, CheckCircle, Eye, LockKey, MagnifyingGlass, Microphone, Pulse, ShieldCheck, SignOut, Siren, SpeakerHigh, UsersThree, Warning } from "@phosphor-icons/react";

type Incident = { id: string; title: string; subject: string; severity: "Critical" | "High" | "Medium" | "Low"; status: "Open" | "Investigating" | "Contained"; time: string; source: string; evidence: string[]; recommendation: string };

const seedIncidents: Incident[] = [
  { id: "IR-1042", title: "Anomalous outbound connection", subject: "10.0.4.25 → 203.0.113.45", severity: "Critical", status: "Open", time: "2 min ago", source: "Network sensor", evidence: ["First-seen destination", "4.8 GB transferred in 11 minutes", "Connection followed privileged login"], recommendation: "Isolate endpoint WS-1025, block the destination, and preserve volatile evidence." },
  { id: "IR-1041", title: "Suspicious login blocked", subject: "jdoe@agency.gov", severity: "High", status: "Contained", time: "8 min ago", source: "Identity", evidence: ["Impossible travel detected", "MFA challenge failed twice", "Source IP has poor reputation"], recommendation: "Reset active sessions and verify the user through an approved channel." },
  { id: "IR-1039", title: "Database activity anomaly", subject: "DB-PROD-01", severity: "High", status: "Investigating", time: "19 min ago", source: "Database", evidence: ["Query volume 6.2× baseline", "Service account used outside normal window", "No approved change ticket found"], recommendation: "Pause the service credential and compare queries with the deployment record." },
  { id: "IR-1036", title: "Privileged access granted", subject: "admin.service@agency.gov", severity: "Medium", status: "Investigating", time: "34 min ago", source: "PAM", evidence: ["Temporary admin role granted", "Approval chain complete", "Session recording active"], recommendation: "Monitor until the privilege expires and confirm the work ticket is closed." },
  { id: "IR-1032", title: "Policy check completed", subject: "Data Loss Prevention Policy", severity: "Low", status: "Contained", time: "1 hr ago", source: "Compliance", evidence: ["148 controls evaluated", "2 warnings recorded", "No critical failure"], recommendation: "Review the two warning-level controls during the next policy cycle." },
];

const severityRank = { Critical: 4, High: 3, Medium: 2, Low: 1 };

export default function SecurityOperations({ user, auditCount, signOutPath }: { user: { email: string; displayName: string; role: string }, auditCount: number, signOutPath: string }) {
  const [incidents, setIncidents] = useState(seedIncidents);
  const [selected, setSelected] = useState<Incident>(seedIncidents[0]);
  const [filter, setFilter] = useState("All");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("IRIS is ready. Ask about risk, evidence, affected assets, or the next response action.");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastUpdate, setLastUpdate] = useState("just now");

  const visible = useMemo(() => incidents.filter(i => filter === "All" || i.severity === filter), [incidents, filter]);
  const open = incidents.filter(i => i.status !== "Contained").length;
  const critical = incidents.filter(i => i.severity === "Critical" && i.status !== "Contained").length;
  const risk = Math.min(99, incidents.reduce((sum, i) => sum + (i.status === "Contained" ? 0 : severityRank[i.severity] * 7), 18));

  function analyze(value = question) {
    const q = value.trim().toLowerCase();
    let response: string;
    if (!q) response = "Ask a specific question, for example: What is the highest priority incident?";
    else if (q.includes("highest") || q.includes("priority") || q.includes("critical") || q.includes("prioridad")) response = `${selected.id} is the current priority because ${selected.evidence.join(", ").toLowerCase()}. Recommended action: ${selected.recommendation}`;
    else if (q.includes("complete") || q.includes("summary") || q.includes("resumen") || q.includes("system")) response = `IRIS analyzed ${incidents.length} active signals. ${critical} critical and ${open} unresolved incidents require attention. The strongest correlated risk is ${selected.title.toLowerCase()} affecting ${selected.subject}. Evidence: ${selected.evidence.join("; ")}. ${selected.recommendation}`;
    else if (q.includes("evidence") || q.includes("evidencia") || q.includes("why") || q.includes("por qué")) response = `${selected.id} was raised from ${selected.source}. Supporting evidence: ${selected.evidence.join("; ")}. Confidence is high because multiple independent signals agree.`;
    else if (q.includes("action") || q.includes("do") || q.includes("hacer") || q.includes("response")) response = `For ${selected.id}: ${selected.recommendation} Keep the incident open until identity, endpoint, and network telemetry all confirm containment.`;
    else response = `I reviewed your question against the current incident context. ${selected.title} (${selected.id}) is ${selected.status.toLowerCase()} with ${selected.severity.toLowerCase()} severity. ${selected.recommendation}`;
    setAnswer(response);
  }

  function speak() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(answer);
    utterance.onend = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  function listen() {
    type Recognition = new () => { lang: string; start(): void; onresult: (e: { results: { 0: { 0: { transcript: string } } }[] }) => void };
    const speechWindow = window as unknown as { SpeechRecognition?: Recognition; webkitSpeechRecognition?: Recognition };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) { setAnswer("Voice input is not available in this browser. You can type your question below."); return; }
    const recognition = new SpeechRecognition(); recognition.lang = "en-US";
    recognition.onresult = e => { const transcript = e.results[0][0].transcript; setQuestion(transcript); analyze(transcript); };
    recognition.start();
  }

  function contain() {
    setIncidents(all => all.map(i => i.id === selected.id ? { ...i, status: "Contained" } : i));
    setSelected({ ...selected, status: "Contained" });
    setAnswer(`${selected.id} has been marked contained. IRIS will continue monitoring for recurrence and preserve the incident evidence.`);
  }

  return <main className="soc-shell">
    <aside className="soc-sidebar">
      <div className="soc-brand"><ShieldCheck weight="duotone" /><div><strong>IRIS</strong><span>SECURITY AI</span></div></div>
      <nav><a className="active"><Pulse /> Operations</a><a><Siren /> Incidents <b>{open}</b></a><a><ChartLineUp /> Intelligence</a><a><LockKey /> Audit log <b>{auditCount}</b></a>{user.role === "ADMIN" && <a href="/admin/users"><UsersThree /> Access control</a>}</nav>
      <div className="soc-user"><span className="avatar">{user.displayName.slice(0,1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.role}</small></div></div>
    </aside>

    <section className="soc-main">
      <header className="soc-header"><div><p>IRIS COMMAND CENTER</p><h1>Security operations</h1><span><i /> All systems connected · Updated {lastUpdate}</span></div><div className="header-actions"><button aria-label="Refresh data" onClick={() => setLastUpdate("just now")}><Pulse /></button><button aria-label="Notifications"><Bell /><b>{open}</b></button><a href={signOutPath}><SignOut /> Sign out</a></div></header>

      <section className="metric-row">
        <article><span>Risk score</span><strong>{risk}<small>/100</small></strong><em className="risk-high">Elevated</em></article>
        <article><span>Open incidents</span><strong>{open}</strong><em>{critical} critical</em></article>
        <article><span>Protected assets</span><strong>1,284</strong><em className="healthy">98.7% healthy</em></article>
        <article><span>Mean response</span><strong>4m 12s</strong><em className="healthy">↓ 18% today</em></article>
      </section>

      <section className="soc-grid">
        <div className="incident-card">
          <div className="card-head"><div><h2>Live security activity</h2><p>Correlated signals ranked by operational risk</p></div><div className="filters">{["All","Critical","High","Medium"].map(f => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{f}</button>)}</div></div>
          <div className="incident-list">{visible.map(i => <button key={i.id} className={`incident-row ${selected.id === i.id ? "selected" : ""}`} onClick={() => setSelected(i)}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><span className="incident-copy"><strong>{i.title}</strong><small>{i.subject} · {i.source}</small></span><span className={`status ${i.status.toLowerCase()}`}>{i.status}</span><time>{i.time}</time></button>)}</div>
        </div>

        <aside className="analysis-card">
          <div className="iris-orb"><Eye weight="duotone" /></div><div className="analysis-title"><span>ASK IRIS</span><i>LIVE ANALYSIS</i></div>
          <h2>{selected.title}</h2><p className="case-id">{selected.id} · {selected.subject}</p>
          <div className="evidence"><strong>Correlated evidence</strong>{selected.evidence.map(e => <span key={e}><CheckCircle weight="fill" /> {e}</span>)}</div>
          <div className="recommendation"><strong>Recommended response</strong><p>{selected.recommendation}</p></div>
          <button className="contain-btn" disabled={selected.status === "Contained"} onClick={contain}>{selected.status === "Contained" ? <><CheckCircle /> Contained</> : <><ShieldCheck /> Contain incident</>}</button>
        </aside>
      </section>

      <section className="ask-bar"><div className="ask-answer"><ShieldCheck weight="duotone" /><p>{answer}</p><button className={isSpeaking ? "speaking" : ""} onClick={speak} aria-label="Read analysis aloud"><SpeakerHigh /></button></div><div className="ask-input"><MagnifyingGlass /><input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()} placeholder="Ask IRIS about risk, evidence, or the next action…" /><button onClick={listen} aria-label="Ask by voice"><Microphone /></button><button onClick={() => analyze()}>Analyze</button></div></section>
    </section>
  </main>;
}
