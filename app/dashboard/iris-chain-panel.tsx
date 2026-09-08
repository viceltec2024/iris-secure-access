"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowSquareOut, ArrowUp, ChartLineUp, CheckCircle, Coins, Cube, Link, Plus, Pulse, QrCode, ShieldCheck, Wallet, Warning, X } from "@phosphor-icons/react";
import IrisTokenMark from "../iris-token-mark";
import QRCode from "qrcode";
import type { Language } from "./dashboard-i18n";
import { isEvmAddress, type WalletProvider } from "../../lib/iris-chain";
import { ROBINHOOD_CONNECT_URL, ROBINHOOD_WALLET_URL } from "../../lib/iris-purchases";
import { BASE_MAINNET_CHAIN_ID, getMetaMaskClient, subscribeMetaMaskDisplayUri } from "./metamask-client";
import { connectInjectedWallet, detectInjectedProvider } from "./wallet-providers";
import IrisPurchaseDesk from "./iris-purchase-desk";
import { IRIS_TOKEN_BYTECODE } from "./iris-token-artifact";
import { bumpGasLimit, tokenDeployMessage } from "../../lib/iris-token-deploy";

type Block = { height: number; hash: string; transactionCount: number; validator: string };
type ChainTransaction = { id: string; blockHeight: number | null; type: string; payloadHash: string; status: "PENDING" | "CONFIRMED" };
type ChainState = { consensus: string; status: string; blocks: Block[]; transactions: ChainTransaction[]; pending: number };
type WalletMovement = { hash: string; from: string; to: string; value: string; timestamp: string; blockNumber: number; status: string; method: string };
type WalletLiveState = { balance: string; blockNumber: number; transactions: WalletMovement[]; updatedAt: string; explorerUrl: string };
type TransactionReceipt = { contractAddress?: string | null; status?: string };
type ActivitySample = { time: number; height: number; transactions: number; pending: number; latency: number };
type TokenOperations = { contract: string; network: string; chainId: number; blockNumber: number; contractLive: boolean; totalSupply: string; walletBalance: string; holders: number; transfers: Array<{ hash: string; from: string; to: string; value: string; timestamp: string; blockNumber: number }>; verified: boolean; distribution: Array<{ label: string; percent: number; amount: string }>; readiness: { contract: boolean; metadata: boolean; treasuryMultisig: boolean; vesting: boolean; liquidity: boolean }; updatedAt: string };

function shortHash(value: string) { return `${value.slice(0, 10)}…${value.slice(-8)}`; }
function chartPoints(values: number[], width = 360, height = 92) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  return values.map((value, index) => `${values.length === 1 ? width : (index / (values.length - 1)) * width},${height - 8 - ((value - min) / range) * (height - 22)}`).join(" ");
}

export default function IrisChainPanel({ language, isAdmin }: { language: Language; isAdmin: boolean }) {
  const [state, setState] = useState<ChainState | null>(null);
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState("");
  const [walletChain, setWalletChain] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletLive, setWalletLive] = useState<WalletLiveState | null>(null);
  const [showWalletQr, setShowWalletQr] = useState(false);
  const [walletQrImage, setWalletQrImage] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [tokenDeployOpen, setTokenDeployOpen] = useState(false);
  const [tokenDeploying, setTokenDeploying] = useState(false);
  const [tokenStatus, setTokenStatus] = useState("");
  const [tokenOperations, setTokenOperations] = useState<TokenOperations | null>(null);
  const [activityHistory, setActivityHistory] = useState<ActivitySample[]>([]);
  const [notice, setNotice] = useState("");
  const [watchInput, setWatchInput] = useState("");
  const [walletMode, setWalletMode] = useState<WalletProvider>("watch");
  const [showRobinhood, setShowRobinhood] = useState(false);
  const es = language === "es";
  async function refresh() {
    const started = performance.now();
    const response = await fetch("/api/iris-chain", { cache: "no-store" });
    if (response.ok) {
      const next = await response.json() as ChainState;
      setState(next);
      setActivityHistory(history => [...history, { time: Date.now(), height: next.blocks[0]?.height ?? 0, transactions: next.transactions.length, pending: next.pending, latency: Math.round(performance.now() - started) }].slice(-24));
    }
  }
  useEffect(() => {
    const unsubscribe = subscribeMetaMaskDisplayUri(uri => {
      setShowWalletQr(true);
      void QRCode.toDataURL(uri, {
        width: 300,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#06111d", light: "#ffffff" },
      }).then(setWalletQrImage).catch(() => setWalletQrImage(""));
    });
    void refresh();
    const chainTimer = window.setInterval(() => void refresh(), 5_000);
    void fetch("/api/iris-token").then(response => response.ok ? response.json() : null).then(data => setTokenAddress(data?.address || "")).catch(() => undefined);
    void fetch("/api/wallet-session").then(response => response.ok ? response.json() : null).then((session: { connected?: boolean; address?: string; chainId?: string; mode?: WalletProvider } | null) => {
      if (session?.connected && session.address) {
        setWallet(session.address);
        setWalletChain(session.chainId || BASE_MAINNET_CHAIN_ID);
        setWatchInput(session.address);
        setWalletMode(session.mode || "watch");
        setNotice(es ? "Wallet conectada. IRIS la está monitoreando en Base." : "Wallet connected. IRIS is monitoring it on Base.");
        return;
      }
      return getMetaMaskClient().then(client => {
        setWallet(client.getAccount() || "");
        setWalletChain(client.getChainId() || "");
      });
    }).catch(() => undefined);
    return () => { unsubscribe(); window.clearInterval(chainTimer); };
  }, []);
  useEffect(() => {
    if (!wallet) { setWalletLive(null); return; }
    let active = true;
    const load = () => void fetch(`/api/base-wallet?address=${encodeURIComponent(wallet)}`).then(response => response.ok ? response.json() : null).then(data => { if (active && data) setWalletLive(data as WalletLiveState); }).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [wallet]);
  useEffect(() => {
    if (!tokenAddress) { setTokenOperations(null); return; }
    let active = true;
    const load = () => void fetch(`/api/iris-token-operations${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ""}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => { if (active && data) setTokenOperations(data as TokenOperations); }).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [tokenAddress, wallet]);
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
  async function persistWallet(address: string, mode: WalletProvider = "watch") {
    const response = await fetch("/api/wallet-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect", address, mode }) });
    const session = await response.json() as { connected?: boolean; address?: string; chainId?: string; error?: string };
    if (!response.ok || !session.address) throw new Error(session.error || "wallet");
    setWallet(session.address);
    setWalletChain(session.chainId || BASE_MAINNET_CHAIN_ID);
    setWalletMode(mode);
    setWatchInput(session.address);
    setShowWalletQr(false); setWalletQrImage("");
    setNotice(es ? "Wallet conectada. IRIS la está monitoreando en vivo en Base." : "Wallet connected. IRIS is monitoring it live on Base.");
    return session.address;
  }

  async function connectWatchWallet() {
    const address = watchInput.trim();
    if (!isEvmAddress(address)) {
      setNotice(es ? "Pega una wallet válida (0x y 40 caracteres)." : "Paste a valid wallet (0x and 40 characters).");
      return;
    }
    setWalletBusy(true); setNotice("");
    try { await persistWallet(address, "watch"); }
    catch { setNotice(es ? "No se pudo conectar esa wallet." : "That wallet could not be connected."); }
    finally { setWalletBusy(false); }
  }
  async function connectWallet() {
    setWalletBusy(true); setShowWalletQr(false); setWalletQrImage(""); setNotice("");
    try {
      const injected = await connectInjectedWallet("metamask");
      if (injected && isEvmAddress(injected.address)) {
        await persistWallet(injected.address, "metamask");
        setNotice(es ? "MetaMask conectada en este navegador. IRIS la monitorea en Base." : "MetaMask connected in this browser. IRIS is monitoring it on Base.");
        return;
      }
      setShowWalletQr(true);
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
      const address = accounts[0] || client.getAccount() || "";
      if (!isEvmAddress(address)) throw new Error("wallet");
      await persistWallet(address, "metamask");
      setNotice(es ? "Wallet de MetaMask conectada. IRIS la está monitoreando en Base." : "MetaMask wallet connected. IRIS is monitoring it on Base.");
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
      setNotice(code === 4001 ? (es ? "Conexión cancelada en MetaMask." : "Connection cancelled in MetaMask.") : code === -32002 ? (es ? "Ya hay una solicitud abierta en MetaMask." : "A MetaMask request is already open.") : (es ? "No se pudo conectar con MetaMask." : "Could not connect to MetaMask."));
    } finally { setWalletBusy(false); }
  }
  async function connectRobinhood() {
    setWalletBusy(true); setNotice("");
    try {
      const injected = await connectInjectedWallet("robinhood");
      if (injected && isEvmAddress(injected.address)) {
        await persistWallet(injected.address, "robinhood");
        setShowRobinhood(false);
        setNotice(es ? "Robinhood Wallet conectada. IRIS la monitorea y puede proponer compras para que tú las apruebes." : "Robinhood Wallet connected. IRIS is monitoring it and can propose buys for you to approve.");
        return;
      }
      setShowRobinhood(true);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
      setNotice(code === 4001 ? (es ? "Conexión cancelada en Robinhood." : "Connection cancelled in Robinhood.") : (es ? "Abre Robinhood Wallet o pega su dirección 0x." : "Open Robinhood Wallet or paste its 0x address."));
    } finally { setWalletBusy(false); }
  }
  async function persistRobinhoodAddress() {
    const address = watchInput.trim();
    if (!isEvmAddress(address)) {
      setNotice(es ? "Pega la dirección 0x de tu Robinhood Wallet." : "Paste the 0x address from your Robinhood Wallet.");
      return;
    }
    setWalletBusy(true);
    try {
      await persistWallet(address, "robinhood");
      setShowRobinhood(false);
      setNotice(es ? "Robinhood Wallet en monitoreo. Las compras siguen pidiendo tu aprobación en Robinhood." : "Robinhood Wallet is monitored. Purchases still require your Robinhood approval.");
    } catch {
      setNotice(es ? "No se pudo guardar esa wallet de Robinhood." : "That Robinhood wallet could not be saved.");
    } finally { setWalletBusy(false); }
  }
  async function cancelWalletQr() {
    setShowWalletQr(false); setWalletQrImage(""); setWalletBusy(false);
    try { const client = await getMetaMaskClient(); await client.disconnect(); } catch { /* Session may not exist yet. */ }
  }
  async function disconnectWallet() {
    setWalletBusy(true);
    try {
      await fetch("/api/wallet-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) }).catch(() => undefined);
      try { const client = await getMetaMaskClient(); await client.disconnect(); } catch { /* Local sessions have no MetaMask client. */ }
      setWallet(""); setWalletChain(""); setWalletMode("watch"); setWatchInput(""); setShowRobinhood(false); setNotice(es ? "Wallet desconectada." : "Wallet disconnected.");
    } finally { setWalletBusy(false); }
  }
  async function addIrisToken(address = tokenAddress) {
    if (!address) return;
    const client = await getMetaMaskClient();
    const provider = client.getProvider() as unknown as { request(args: { method: string; params?: unknown }): Promise<unknown> };
    const image = `${window.location.origin}/assets/iris-token.svg`;
    await provider.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address, symbol: "IRIS", decimals: 18, image } } });
    setNotice(es ? "IRIS Token fue agregado a MetaMask." : "IRIS Token was added to MetaMask.");
  }
  async function deployIrisToken() {
    if (!isAdmin || tokenAddress) return;
    setTokenDeploying(true); setTokenStatus(es ? "Abre MetaMask y confirma la transacción…" : "Open MetaMask and confirm the transaction…"); setNotice("");
    try {
      const connected = await connectInjectedWallet("metamask");
      const injected = connected?.provider || detectInjectedProvider("metamask");
      const from = connected?.address || "";
      if (!injected || !isEvmAddress(from)) throw Object.assign(new Error("NO_METAMASK"), { code: "NO_METAMASK" });
      await persistWallet(from, "metamask");
      const tx: { from: string; data: string; gas?: string } = { from, data: IRIS_TOKEN_BYTECODE };
      try {
        const gas = await injected.request({ method: "eth_estimateGas", params: [{ from, data: IRIS_TOKEN_BYTECODE }] }) as string;
        if (typeof gas === "string" && gas.startsWith("0x")) tx.gas = bumpGasLimit(gas);
      } catch { /* MetaMask will estimate gas. */ }
      const transactionHash = await injected.request({ method: "eth_sendTransaction", params: [tx] }) as string;
      if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) throw new Error("DEPLOYMENT_NOT_CONFIRMED");
      setTokenStatus(es ? "Transacción enviada. Esperando confirmación de Base…" : "Transaction sent. Waiting for Base confirmation…");
      let address = "";
      for (let attempt = 0; attempt < 90 && !address; attempt += 1) {
        if (attempt) await new Promise(resolve => window.setTimeout(resolve, 3_000));
        const response = await fetch("/api/iris-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionHash }) });
        const data = await response.json().catch(() => ({})) as { address?: string; pending?: boolean; error?: string };
        if (data.address) { address = data.address; break; }
        if (response.status === 202 || data.pending) continue;
        throw new Error(data.error || "DEPLOYMENT_RECORD_FAILED");
      }
      if (!address) throw new Error("DEPLOYMENT_NOT_CONFIRMED");
      setTokenAddress(address); setTokenDeployOpen(false); setTokenStatus("");
      await addIrisToken(address);
      setNotice(es ? "IRIS Token fue creado en Base Mainnet y agregado a MetaMask." : "IRIS Token was created on Base Mainnet and added to MetaMask.");
    } catch (error) {
      setTokenStatus(tokenDeployMessage(error, language));
    } finally { setTokenDeploying(false); }
  }
  if (!state) return <section className="module-panel chain-loading"><Pulse /> {es ? "Sincronizando IRIS Chain…" : "Syncing IRIS Chain…"}</section>;
  const latest = state.blocks[0];
  return <section className="module-panel chain-panel">
    {tokenDeployOpen && <div className="approval-backdrop" role="presentation"><section className="approval-dialog token-deploy-dialog" role="dialog" aria-modal="true" aria-labelledby="token-deploy-title">
      <button className="approval-close" aria-label={es ? "Cerrar" : "Close"} disabled={tokenDeploying} onClick={() => setTokenDeployOpen(false)}><X /></button>
      <span className="approval-icon"><IrisTokenMark size={56} /></span>
      <p>{es ? "BASE MAINNET · TRANSACCIÓN REAL" : "BASE MAINNET · REAL TRANSACTION"}</p>
      <h2 id="token-deploy-title">{es ? "Crear IRIS Token" : "Create IRIS Token"}</h2>
      <div className="token-deploy-summary"><span><b>1,000,000,000</b> IRIS</span><span>{es ? "Suministro fijo" : "Fixed supply"}</span><span>{es ? "18 decimales" : "18 decimals"}</span></div>
      <div className="token-gas-warning"><Warning weight="fill" /><span><strong>{es ? "MetaMask cobrará gas real" : "MetaMask will charge real gas"}</strong>{es ? "Revisa el costo que muestra MetaMask antes de confirmar. Los tokens se enviarán a tu wallet conectada." : "Review the cost shown by MetaMask before confirming. The tokens will be sent to your connected wallet."}</span></div>
      {tokenStatus && <div className="token-deploy-status"><Pulse />{tokenStatus}</div>}
      <div className="approval-actions"><button disabled={tokenDeploying} onClick={() => setTokenDeployOpen(false)}>{es ? "Cancelar" : "Cancel"}</button><button disabled={tokenDeploying} onClick={() => void deployIrisToken()}><IrisTokenMark size={16} />{tokenDeploying ? (es ? "Procesando…" : "Processing…") : (es ? "Continuar en MetaMask" : "Continue in MetaMask")}</button></div>
    </section></div>}
    {showWalletQr && <div className="wallet-qr-backdrop" role="presentation"><div className="wallet-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-qr-title">
      <button className="wallet-qr-close" aria-label={es ? "Cerrar" : "Close"} onClick={() => void cancelWalletQr()}><X /></button>
      <div className="wallet-qr-brand"><QrCode weight="duotone" /></div>
      <p>METAMASK CONNECT</p>
      <h2 id="wallet-qr-title">{es ? "Escanea para conectar" : "Scan to connect"}</h2>
      <span className="wallet-qr-help">{es ? "Abre MetaMask en tu teléfono, toca el escáner y apunta a este código." : "Open MetaMask on your phone, tap the scanner, and point it at this code."}</span>
      <div className="wallet-qr-frame">{walletQrImage ? <img src={walletQrImage} alt={es ? "Código QR para conectar MetaMask" : "QR code to connect MetaMask"} /> : <div className="wallet-qr-loading"><Pulse /><strong>{es ? "Generando QR seguro…" : "Generating secure QR…"}</strong></div>}</div>
      <a className="wallet-mobile-deeplink" href={`https://metamask.app.link/dapp/${typeof window === "undefined" ? "iris-secure-access.taylor-667.chatgpt.site/dashboard" : `${window.location.host}/dashboard`}`}>{es ? "Abrir MetaMask en este teléfono" : "Open MetaMask on this phone"}</a>
      <div className="wallet-qr-status"><i />{es ? "Esperando confirmación en MetaMask" : "Waiting for confirmation in MetaMask"}</div>
      <small>{es ? "El código es temporal. IRIS nunca solicita tu frase secreta." : "The code is temporary. IRIS never asks for your secret phrase."}</small>
    </div></div>}
    {showRobinhood && <div className="wallet-qr-backdrop" role="presentation"><div className="wallet-qr-dialog robinhood-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="robinhood-connect-title">
      <button className="wallet-qr-close" aria-label={es ? "Cerrar" : "Close"} onClick={() => setShowRobinhood(false)}><X /></button>
      <div className="wallet-qr-brand"><Wallet weight="duotone" /></div>
      <p>ROBINHOOD CONNECT</p>
      <h2 id="robinhood-connect-title">{es ? "Conecta Robinhood" : "Connect Robinhood"}</h2>
      <span className="wallet-qr-help">{es ? "IRIS abre la Wallet oficial o Connect. Pega la dirección 0x para monitorearla. Las compras se confirman en Robinhood, nunca aquí." : "IRIS opens the official Wallet or Connect. Paste the 0x address to monitor it. Purchases are confirmed in Robinhood, never here."}</span>
      <div className="robinhood-connect-actions">
        <a href={ROBINHOOD_WALLET_URL} target="_blank" rel="noreferrer">{es ? "Abrir Robinhood Wallet" : "Open Robinhood Wallet"}<ArrowSquareOut /></a>
        <a href={ROBINHOOD_CONNECT_URL} target="_blank" rel="noreferrer">Robinhood Connect<ArrowSquareOut /></a>
      </div>
      <label className="robinhood-address-field"><span>{es ? "Dirección de Robinhood Wallet" : "Robinhood Wallet address"}</span><input value={watchInput} onChange={event => setWatchInput(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" /></label>
      <button className="chain-submit" disabled={walletBusy} onClick={() => void persistRobinhoodAddress()}>{es ? "Monitorear esta Robinhood Wallet" : "Monitor this Robinhood Wallet"}</button>
      <small>{es ? "IRIS no pide tu usuario, contraseña ni frase secreta de Robinhood." : "IRIS never asks for your Robinhood username, password, or secret phrase."}</small>
    </div></div>}
    <div className="module-toolbar"><div><h2>IRIS Chain</h2><p>{es ? "Registro inmutable de eventos, aprobaciones y evidencia de seguridad." : "Immutable ledger for security events, approvals, and evidence."}</p></div><span className="chain-online"><i />{state.status}</span></div>
    <form className="wallet-connect-bar wallet-connect-bar-providers" onSubmit={event => { event.preventDefault(); void connectWatchWallet(); }}>
      <div><span>{es ? "METAMASK · ROBINHOOD · BASE" : "METAMASK · ROBINHOOD · BASE"}</span><strong>{wallet ? (walletMode === "robinhood" ? (es ? "Robinhood Wallet en monitoreo" : "Robinhood Wallet monitored") : walletMode === "metamask" ? (es ? "MetaMask conectada" : "MetaMask connected") : (es ? "IRIS está monitoreando esta wallet" : "IRIS is monitoring this wallet")) : (es ? "Conecta MetaMask o Robinhood" : "Connect MetaMask or Robinhood")}</strong><small>{wallet || (es ? "Conexión directa a MetaMask, Robinhood Wallet, o pega cualquier 0x para vigilarla." : "Direct MetaMask, Robinhood Wallet, or paste any 0x address to watch it.")}</small></div>
      <label><span>{es ? "Dirección" : "Address"}</span><input value={watchInput} onChange={event => setWatchInput(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" /></label>
      <button type="submit" disabled={walletBusy}>{walletBusy ? (es ? "Conectando…" : "Connecting…") : (es ? "Monitorear" : "Monitor")}</button>
      <button type="button" className="wallet-metamask" disabled={walletBusy} onClick={() => void connectWallet()}><Wallet />MetaMask</button>
      <button type="button" className="wallet-robinhood" disabled={walletBusy} onClick={() => void connectRobinhood()}><Wallet />Robinhood</button>
    </form>
    <IrisPurchaseDesk language={language} wallet={wallet} walletMode={walletMode} />
    <div className="chain-metrics">
      <article><span>{es ? "Altura" : "Block height"}</span><strong>{latest?.height ?? 0}</strong><small><Cube /> {state.blocks.length} {es ? "bloques recientes" : "recent blocks"}</small></article>
      <article><span>{es ? "Transacciones" : "Transactions"}</span><strong>{state.transactions.length}</strong><small><CheckCircle /> {state.pending} {es ? "pendientes" : "pending"}</small></article>
      <article><span>{es ? "Consenso" : "Consensus"}</span><strong className="chain-consensus">PoA</strong><small><ShieldCheck />{state.consensus}</small></article>
      <article><span>{walletMode === "robinhood" ? "Robinhood" : walletMode === "metamask" ? "MetaMask" : "Base wallet"}</span><strong className="wallet-value">{wallet ? shortHash(wallet) : (es ? "Sin conectar" : "Not connected")}</strong><small className={wallet ? "wallet-network-ready" : ""}><i />{wallet ? (walletMode === "robinhood" ? (es ? "Robinhood · compras con tu OK" : "Robinhood · buys need your OK") : walletMode === "metamask" ? "Base Mainnet · 8453" : (es ? "Monitoreo en vivo" : "Live monitoring")) : (es ? "MetaMask o Robinhood" : "MetaMask or Robinhood")}</small><button disabled={walletBusy} onClick={() => void (wallet ? disconnectWallet() : connectWallet())}><Wallet />{walletBusy ? (es ? "Conectando…" : "Connecting…") : wallet ? (es ? "Desconectar" : "Disconnect") : "MetaMask"}</button></article>
    </div>
    <section className="iris-token-panel"><div className="iris-token-mark"><IrisTokenMark size={50} /></div><div className="iris-token-copy"><span>IRIS TOKEN · BASE MAINNET</span><h3>{tokenAddress ? (es ? "Token oficial conectado" : "Official token connected") : (es ? "Preparado para desplegar" : "Ready to deploy")}</h3><p>{tokenAddress ? shortHash(tokenAddress) : (es ? "1,000,000,000 IRIS · suministro fijo · 18 decimales" : "1,000,000,000 IRIS · fixed supply · 18 decimals")}</p></div><div className="iris-token-actions">{tokenAddress ? <><a href={`https://basescan.org/token/${tokenAddress}`} target="_blank" rel="noreferrer">BaseScan <ArrowSquareOut /></a><button disabled={!wallet} onClick={() => void addIrisToken()}><Wallet />{es ? "Agregar a MetaMask" : "Add to MetaMask"}</button></> : isAdmin ? <button disabled={!wallet || walletChain !== BASE_MAINNET_CHAIN_ID} onClick={() => setTokenDeployOpen(true)}><IrisTokenMark size={16} />{wallet ? (es ? "Desplegar IRIS" : "Deploy IRIS") : (es ? "Conecta MetaMask primero" : "Connect MetaMask first")}</button> : <span>{es ? "Pendiente del administrador" : "Waiting for administrator"}</span>}</div></section>
    {tokenAddress && <section className="token-operations-center">
      <div className="token-ops-head"><div><span><i />{es ? "DATOS REALES · BASE" : "LIVE DATA · BASE"}</span><h3>{es ? "Centro de Operaciones IRIS Token" : "IRIS Token Operations Center"}</h3><p>{es ? "Contrato, balances, distribución y preparación de tesorería." : "Contract, balances, distribution, and treasury readiness."}</p></div><a href="/token" target="_blank">{es ? "Ficha oficial" : "Official profile"}<ArrowSquareOut /></a></div>
      <div className="token-ops-metrics"><article><span>{es ? "Tu balance" : "Your balance"}</span><strong>{wallet ? `${tokenOperations?.walletBalance ?? "—"} IRIS` : "—"}</strong><small>{wallet ? shortHash(wallet) : (es ? "Conecta MetaMask" : "Connect MetaMask")}</small></article><article><span>{es ? "Suministro total" : "Total supply"}</span><strong>{tokenOperations ? Number(tokenOperations.totalSupply).toLocaleString(language) : "—"}</strong><small>IRIS · 18 {es ? "decimales" : "decimals"}</small></article><article><span>{es ? "Titulares indexados" : "Indexed holders"}</span><strong>{tokenOperations?.holders || "—"}</strong><small>{es ? "Datos del explorador" : "Explorer data"}</small></article><article><span>{es ? "Estado del contrato" : "Contract status"}</span><strong className="token-live-state">{tokenOperations?.contractLive ? (es ? "ACTIVO" : "LIVE") : (es ? "CARGANDO" : "LOADING")}</strong><small>{es ? "Bloque" : "Block"} #{tokenOperations?.blockNumber?.toLocaleString() ?? "—"}</small></article></div>
      <div className="token-ops-grid"><div className="token-distribution"><h4>{es ? "Distribución aprobada" : "Approved distribution"}</h4>{tokenOperations?.distribution.map(item => <div key={item.label}><span><b>{item.percent}%</b>{item.label}<em>{item.amount} IRIS</em></span><i><u style={{ width: `${item.percent}%` }} /></i></div>) ?? <p>{es ? "Sincronizando distribución…" : "Syncing distribution…"}</p>}</div><div className="token-readiness"><h4>{es ? "Preparación institucional" : "Institutional readiness"}</h4>{tokenOperations && Object.entries(tokenOperations.readiness).map(([key, ready]) => <div key={key} className={ready ? "ready" : "pending"}><CheckCircle weight="fill" /><span>{({ contract: es ? "Contrato en Base" : "Base contract", metadata: es ? "Logo y metadatos" : "Logo and metadata", treasuryMultisig: es ? "Tesorería multifirma" : "Multisig treasury", vesting: es ? "Vesting del equipo" : "Team vesting", liquidity: es ? "Liquidez IRIS" : "IRIS liquidity" } as Record<string,string>)[key]}</span><b>{ready ? (es ? "LISTO" : "READY") : (es ? "REQUIERE FIRMA" : "SIGNATURE REQUIRED")}</b></div>)}</div></div>
      <div className="token-transfer-head"><h4>{es ? "Transferencias recientes de IRIS" : "Recent IRIS transfers"}</h4><span>{es ? "Actualización cada 15 segundos" : "Refreshes every 15 seconds"}</span></div><div className="token-transfer-list">{tokenOperations?.transfers.map(tx => <a href={`https://basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer" key={tx.hash}><Coins /><div><strong>{tx.value} IRIS</strong><code>{shortHash(tx.from)} → {shortHash(tx.to)}</code></div><small>{tx.timestamp ? new Date(tx.timestamp).toLocaleString(language) : `#${tx.blockNumber}`}</small><ArrowSquareOut /></a>)}{tokenOperations && !tokenOperations.transfers.length && <p>{es ? "El explorador todavía está indexando las transferencias de IRIS." : "The explorer is still indexing IRIS transfers."}</p>}</div>
    </section>}
    <section className="chain-live-charts">
      <div className="chain-live-title"><div><ChartLineUp /><span><b>{es ? "GRÁFICOS EN VIVO" : "LIVE CHARTS"}</b><small>{es ? "Actualización cada 5 segundos" : "Refreshes every 5 seconds"}</small></span></div><em><i />{es ? "SINCRONIZADO" : "SYNCED"}</em></div>
      <div className="chain-chart-grid">
        <article><header><span>{es ? "Altura de la cadena" : "Chain height"}</span><strong>#{latest?.height ?? 0}</strong></header><svg viewBox="0 0 360 100" preserveAspectRatio="none" role="img" aria-label={es ? "Altura de bloques en vivo" : "Live block height"}><defs><linearGradient id="heightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#35d5fb" stopOpacity=".35"/><stop offset="1" stopColor="#35d5fb" stopOpacity="0"/></linearGradient></defs><path className="chart-grid-lines" d="M0 25H360M0 50H360M0 75H360"/><polyline className="chart-area height" points={`0,100 ${chartPoints(activityHistory.map(item => item.height))} 360,100`}/><polyline className="chart-line height" points={chartPoints(activityHistory.map(item => item.height))}/></svg><footer><span>{es ? "Inicio" : "Start"}</span><b>{activityHistory.length ? new Date(activityHistory[activityHistory.length - 1].time).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</b></footer></article>
        <article><header><span>{es ? "Actividad de transacciones" : "Transaction activity"}</span><strong>{state.transactions.length} TX</strong></header><svg viewBox="0 0 360 100" preserveAspectRatio="none" role="img" aria-label={es ? "Transacciones en vivo" : "Live transactions"}><path className="chart-grid-lines" d="M0 25H360M0 50H360M0 75H360"/><polyline className="chart-area tx" points={`0,100 ${chartPoints(activityHistory.map(item => item.transactions))} 360,100`}/><polyline className="chart-line tx" points={chartPoints(activityHistory.map(item => item.transactions))}/><polyline className="chart-line pending" points={chartPoints(activityHistory.map(item => item.pending))}/></svg><footer><span><i className="tx-dot" />TX</span><span><i className="pending-dot" />{es ? "Pendientes" : "Pending"}</span></footer></article>
        <article className="network-pulse-chart"><header><span>{es ? "Pulso de la red" : "Network pulse"}</span><strong>{activityHistory.at(-1)?.latency ?? 0} ms</strong></header><div className="network-radar"><i/><i/><i/><span><Pulse weight="bold" /></span></div><footer><span>{state.consensus}</span><b>{state.status}</b></footer></article>
      </div>
    </section>
    {wallet && <section className="wallet-live-panel">
      <div className="wallet-live-head"><div><span><i /> LIVE · BASE MAINNET</span><h3>{es ? "Movimientos de la wallet" : "Wallet movements"}</h3><p>{es ? "Actualización automática cada 15 segundos" : "Automatically refreshes every 15 seconds"}</p></div><div className="wallet-balance"><span>{es ? "Saldo actual" : "Current balance"}</span><strong>{walletLive?.balance ?? "—"} ETH</strong><small>{es ? "Bloque" : "Block"} #{walletLive?.blockNumber?.toLocaleString() ?? "—"}</small></div></div>
      <div className="wallet-movement-list">{walletLive?.transactions.map(tx => { const incoming = tx.to.toLowerCase() === wallet.toLowerCase(); return <a href={`https://basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer" key={tx.hash}><span className={`movement-direction ${incoming ? "incoming" : "outgoing"}`}>{incoming ? <ArrowDown /> : <ArrowUp />}</span><div><strong>{incoming ? (es ? "Recibido" : "Received") : (es ? "Enviado" : "Sent")} · {tx.method || "transfer"}</strong><code>{shortHash(tx.hash)}</code><small>{tx.timestamp ? new Date(tx.timestamp).toLocaleString(language) : `${es ? "Bloque" : "Block"} #${tx.blockNumber}`}</small></div><span className="movement-value">{incoming ? "+" : "−"}{tx.value} ETH<small>{tx.status}</small></span><ArrowSquareOut className="movement-open" /></a>})}{walletLive && walletLive.transactions.length === 0 && <div className="wallet-empty"><Pulse /><strong>{es ? "Wallet conectada y monitoreada" : "Wallet connected and monitored"}</strong><span>{es ? "Los movimientos nuevos aparecerán aquí automáticamente." : "New movements will appear here automatically."}</span></div>}{!walletLive && <div className="wallet-empty"><Pulse /><strong>{es ? "Cargando actividad en vivo…" : "Loading live activity…"}</strong></div>}</div>
      {walletLive && <a className="wallet-explorer-link" href={walletLive.explorerUrl} target="_blank" rel="noreferrer">{es ? "Ver historial completo en BaseScan" : "View complete history on BaseScan"}<ArrowSquareOut /></a>}
    </section>}
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
