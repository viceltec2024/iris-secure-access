"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Cube, Link, Plus, Pulse, ShieldCheck, Wallet } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";

type Block = { height: number; hash: string; transactionCount: number; validator: string };
type ChainTransaction = { id: string; blockHeight: number | null; type: string; payloadHash: string; status: "PENDING" | "CONFIRMED" };
type ChainState = { consensus: string; status: string; blocks: Block[]; transactions: ChainTransaction[]; pending: number };

function shortHash(value: string) { return `${value.slice(0, 10)}…${value.slice(-8)}`; }

export default function IrisChainPanel({ language, isAdmin }: { language: Language; isAdmin: boolean }) {
  const [state, setState] = useState<ChainState | null>(null);
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState("");
  const [notice, setNotice] = useState("");
  const es = language === "es";
  async function refresh() { const response = await fetch("/api/iris-chain"); if (response.ok) setState(await response.json() as ChainState); }
  useEffect(() => { void refresh(); }, []);
  async function submitTransaction() {
    if (!payload.trim()) return;
    setBusy(true); setNotice("");
    const response = await fetch("/api/iris-chain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", type: "SECURITY_ATTESTATION", payload }) });
    setNotice(response.ok ? (es ? "Transacción enviada a IRIS Chain." : "Transaction submitted to IRIS Chain.") : (es ? "No se pudo enviar la transacción." : "Transaction could not be submitted."));
    if (response.ok) { setPayload(""); await refresh(); }
    setBusy(false);
  }
  async function sealBlock() {
    setBusy(true); setNotice("");
    const response = await fetch("/api/iris-chain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seal" }) });
    const data = await response.json() as { error?: string };
    setNotice(response.ok ? (es ? "Nuevo bloque sellado y verificado." : "New block sealed and verified.") : (data.error || (es ? "No se pudo sellar el bloque." : "Block could not be sealed.")));
    if (response.ok) await refresh();
    setBusy(false);
  }
  async function connectWallet() {
    const ethereum = (window as typeof window & { ethereum?: { request(args: { method: string }): Promise<string[]> } }).ethereum;
    if (!ethereum) { setNotice(es ? "Instala MetaMask para conectar una wallet de Base." : "Install MetaMask to connect a Base wallet."); return; }
    try { const accounts = await ethereum.request({ method: "eth_requestAccounts" }); setWallet(accounts[0] || ""); }
    catch { setNotice(es ? "Conexión de wallet cancelada." : "Wallet connection cancelled."); }
  }
  if (!state) return <section className="module-panel chain-loading"><Pulse /> {es ? "Sincronizando IRIS Chain…" : "Syncing IRIS Chain…"}</section>;
  const latest = state.blocks[0];
  return <section className="module-panel chain-panel">
    <div className="module-toolbar"><div><h2>IRIS Chain</h2><p>{es ? "Registro inmutable de eventos, aprobaciones y evidencia de seguridad." : "Immutable ledger for security events, approvals, and evidence."}</p></div><span className="chain-online"><i />{state.status}</span></div>
    <div className="chain-metrics">
      <article><span>{es ? "Altura" : "Block height"}</span><strong>{latest?.height ?? 0}</strong><small><Cube /> {state.blocks.length} {es ? "bloques recientes" : "recent blocks"}</small></article>
      <article><span>{es ? "Transacciones" : "Transactions"}</span><strong>{state.transactions.length}</strong><small><CheckCircle /> {state.pending} {es ? "pendientes" : "pending"}</small></article>
      <article><span>{es ? "Consenso" : "Consensus"}</span><strong className="chain-consensus">PoA</strong><small><ShieldCheck />{state.consensus}</small></article>
      <article><span>Base wallet</span><strong className="wallet-value">{wallet ? shortHash(wallet) : (es ? "Sin conectar" : "Not connected")}</strong><button onClick={() => void connectWallet()}><Wallet />{wallet ? (es ? "Conectada" : "Connected") : (es ? "Conectar" : "Connect")}</button></article>
    </div>
    <div className="chain-grid">
      <div className="chain-card"><div className="chain-card-title"><div><h3>{es ? "Explorador de bloques" : "Block explorer"}</h3><p>{es ? "Cadena SHA-256 verificable" : "Verifiable SHA-256 chain"}</p></div>{isAdmin && <button disabled={busy || state.pending === 0} onClick={() => void sealBlock()}><Plus />{es ? "Sellar bloque" : "Seal block"}</button>}</div>
        <div className="block-list">{state.blocks.map(block => <article key={block.height}><span className="block-cube"><Cube weight="duotone" /></span><div><strong>Block #{block.height}</strong><code>{shortHash(block.hash)}</code></div><dl><div><dt>TX</dt><dd>{block.transactionCount}</dd></div><div><dt>{es ? "Validador" : "Validator"}</dt><dd>{block.validator === "iris-genesis" ? "IRIS" : block.validator.split("@")[0]}</dd></div></dl></article>)}</div>
      </div>
      <div className="chain-card"><div className="chain-card-title"><div><h3>{es ? "Nueva certificación" : "New attestation"}</h3><p>{es ? "Registra evidencia sin incluir secretos." : "Record evidence without including secrets."}</p></div></div>
        <textarea value={payload} maxLength={1000} onChange={event => setPayload(event.target.value)} placeholder={es ? "Ej.: Política Zero Trust revisada y aprobada…" : "Example: Zero Trust policy reviewed and approved…"} />
        <button className="chain-submit" disabled={busy || !payload.trim()} onClick={() => void submitTransaction()}><Link />{es ? "Enviar a la cadena" : "Submit to chain"}</button>
        {notice && <p className="chain-notice">{notice}</p>}
        <h3 className="tx-heading">{es ? "Transacciones recientes" : "Recent transactions"}</h3>
        <div className="tx-list">{state.transactions.map(tx => <article key={tx.id}><span className={`tx-state ${tx.status.toLowerCase()}`}><CheckCircle weight="fill" /></span><div><strong>{tx.type.replaceAll("_", " ")}</strong><code>{shortHash(tx.payloadHash)}</code></div><b>{tx.status === "PENDING" ? (es ? "PENDIENTE" : "PENDING") : `#${tx.blockHeight}`}</b></article>)}{!state.transactions.length && <p className="chain-empty">{es ? "Todavía no hay transacciones." : "No transactions yet."}</p>}</div>
      </div>
    </div>
  </section>;
}
