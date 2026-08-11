"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Cube, Link, Plus, Pulse, ShieldCheck, Wallet } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import { BASE_MAINNET_CHAIN_ID, getMetaMaskClient } from "./metamask-client";

type Block = { height: number; hash: string; transactionCount: number; validator: string };
type ChainTransaction = { id: string; blockHeight: number | null; type: string; payloadHash: string; status: "PENDING" | "CONFIRMED" };
type ChainState = { consensus: string; status: string; blocks: Block[]; transactions: ChainTransaction[]; pending: number };

function shortHash(value: string) { return `${value.slice(0, 10)}…${value.slice(-8)}`; }

export default function IrisChainPanel({ language, isAdmin }: { language: Language; isAdmin: boolean }) {
  const [state, setState] = useState<ChainState | null>(null);
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState("");
  const [walletChain, setWalletChain] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const es = language === "es";
  async function refresh() { const response = await fetch("/api/iris-chain"); if (response.ok) setState(await response.json() as ChainState); }
  useEffect(() => {
    void refresh();
    void getMetaMaskClient().then(client => {
      setWallet(client.getAccount() || "");
      setWalletChain(client.getChainId() || "");
    }).catch(() => undefined);
  }, []);
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
    setWalletBusy(true); setNotice("");
    try {
      const client = await getMetaMaskClient();
      const { accounts } = await client.connect({ chainIds: [BASE_MAINNET_CHAIN_ID] });
      await client.switchChain({
        chainId: BASE_MAINNET_CHAIN_ID,
        chainConfiguration: {
          chainId: BASE_MAINNET_CHAIN_ID,
          chainName: "Base Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        },
      });
      setWallet(accounts[0] || client.getAccount() || "");
      setWalletChain(BASE_MAINNET_CHAIN_ID);
      setNotice(es ? "MetaMask conectado a Base Mainnet." : "MetaMask connected to Base Mainnet.");
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
      setNotice(code === 4001 ? (es ? "Conexión cancelada en MetaMask." : "Connection cancelled in MetaMask.") : code === -32002 ? (es ? "Ya hay una solicitud abierta en MetaMask." : "A MetaMask request is already open.") : (es ? "No se pudo conectar con MetaMask." : "Could not connect to MetaMask."));
    } finally { setWalletBusy(false); }
  }
  async function disconnectWallet() {
    setWalletBusy(true);
    try { const client = await getMetaMaskClient(); await client.disconnect(); setWallet(""); setWalletChain(""); setNotice(es ? "Wallet desconectada." : "Wallet disconnected."); }
    finally { setWalletBusy(false); }
  }
  if (!state) return <section className="module-panel chain-loading"><Pulse /> {es ? "Sincronizando IRIS Chain…" : "Syncing IRIS Chain…"}</section>;
  const latest = state.blocks[0];
  return <section className="module-panel chain-panel">
    <div className="module-toolbar"><div><h2>IRIS Chain</h2><p>{es ? "Registro inmutable de eventos, aprobaciones y evidencia de seguridad." : "Immutable ledger for security events, approvals, and evidence."}</p></div><span className="chain-online"><i />{state.status}</span></div>
    <div className="chain-metrics">
      <article><span>{es ? "Altura" : "Block height"}</span><strong>{latest?.height ?? 0}</strong><small><Cube /> {state.blocks.length} {es ? "bloques recientes" : "recent blocks"}</small></article>
      <article><span>{es ? "Transacciones" : "Transactions"}</span><strong>{state.transactions.length}</strong><small><CheckCircle /> {state.pending} {es ? "pendientes" : "pending"}</small></article>
      <article><span>{es ? "Consenso" : "Consensus"}</span><strong className="chain-consensus">PoA</strong><small><ShieldCheck />{state.consensus}</small></article>
      <article><span>Base wallet</span><strong className="wallet-value">{wallet ? shortHash(wallet) : (es ? "Sin conectar" : "Not connected")}</strong><small className={walletChain === BASE_MAINNET_CHAIN_ID ? "wallet-network-ready" : ""}><i />{wallet ? (walletChain === BASE_MAINNET_CHAIN_ID ? "Base Mainnet · 8453" : (es ? "Red incorrecta" : "Wrong network")) : (es ? "Extensión · QR · móvil" : "Extension · QR · mobile")}</small><button disabled={walletBusy} onClick={() => void (wallet ? disconnectWallet() : connectWallet())}><Wallet />{walletBusy ? (es ? "Conectando…" : "Connecting…") : wallet ? (es ? "Desconectar" : "Disconnect") : (es ? "Conectar MetaMask" : "Connect MetaMask")}</button></article>
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
