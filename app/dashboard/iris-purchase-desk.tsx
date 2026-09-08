"use client";

/* eslint-disable react-hooks/set-state-in-effect -- purchase desk polls scheduled buys */
import { useEffect, useState } from "react";
import { ArrowSquareOut, CheckCircle, CurrencyBtc, CurrencyEth, Pulse, ShieldCheck, Warning, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import type { WalletProvider } from "../../lib/iris-chain";
import { PURCHASE_ASSETS, ROBINHOOD_CONNECT_URL, ROBINHOOD_WALLET_URL, type PurchaseAsset, type PurchaseCadence, type PurchaseDeskState, type PurchaseProposal, type PurchaseSource } from "../../lib/iris-purchases";

const emptyDesk: PurchaseDeskState = { plans: [], proposals: [] };

function sourceLabel(source: PurchaseSource) {
  return source === "robinhood" ? "Robinhood" : "MetaMask";
}

export default function IrisPurchaseDesk({ language, wallet, walletMode }: { language: Language; wallet: string; walletMode: WalletProvider }) {
  const es = language === "es";
  const [desk, setDesk] = useState<PurchaseDeskState>(emptyDesk);
  const [assetChoice, setAssetChoice] = useState<PurchaseAsset>("ETH");
  const [sourceChoice, setSourceChoice] = useState<PurchaseSource | null>(null);
  const source: PurchaseSource = walletMode === "robinhood" || walletMode === "metamask" ? walletMode : (sourceChoice || "metamask");
  const asset: PurchaseAsset = (PURCHASE_ASSETS[assetChoice].sources as readonly string[]).includes(source) ? assetChoice : "ETH";
  const [cadence, setCadence] = useState<PurchaseCadence>("once");
  const [amount, setAmount] = useState("25");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PurchaseProposal | null>(null);

  async function refresh() {
    const response = await fetch("/api/iris-purchases", { cache: "no-store" });
    if (response.ok) setDesk(await response.json() as PurchaseDeskState);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/iris-purchases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as PurchaseDeskState & { error?: string; approved?: PurchaseProposal };
      if (!response.ok) throw new Error(payload.error || "purchase");
      setDesk(payload);
      return payload;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (es ? "No se pudo guardar la compra." : "The purchase could not be saved."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createPlan() {
    const created = await post({
      action: "create_plan",
      asset,
      amountUsd: amount,
      source,
      cadence,
      destinationWallet: wallet,
    });
    if (created) setNotice(es ? "IRIS programó la compra. No gasta nada hasta que apruebes." : "IRIS scheduled the purchase. Nothing is spent until you approve.");
  }

  async function confirmApproval() {
    if (!pending) return;
    const result = await post({ action: "approve", proposalId: pending.id });
    if (!result?.approved) return;
    window.open(result.approved.checkoutUrl, "_blank", "noopener,noreferrer");
    await post({ action: "open", proposalId: result.approved.id });
    setPending(null);
    setNotice(es
      ? `Aprobada. Completa la compra en ${sourceLabel(result.approved.source)}. IRIS no mueve fondos por su cuenta.`
      : `Approved. Finish the purchase in ${sourceLabel(result.approved.source)}. IRIS never moves funds on its own.`);
  }

  const waiting = desk.proposals.filter(item => item.status === "awaiting_approval");
  const history = desk.proposals.filter(item => item.status !== "awaiting_approval").slice(-6).reverse();

  return <section className="iris-purchase-desk">
    {pending && <div className="approval-backdrop" role="presentation"><section className="approval-dialog purchase-approve-dialog" role="dialog" aria-modal="true" aria-labelledby="purchase-approve-title">
      <button className="approval-close" aria-label={es ? "Cerrar" : "Close"} onClick={() => setPending(null)}><X /></button>
      <span className="approval-icon"><ShieldCheck weight="duotone" /></span>
      <p>{es ? "APROBACIÓN DEL USUARIO REQUERIDA" : "USER APPROVAL REQUIRED"}</p>
      <h2 id="purchase-approve-title">{es ? "IRIS no compra sola" : "IRIS does not buy alone"}</h2>
      <div className="token-deploy-summary">
        <span><b>${pending.amountUsd}</b> {pending.asset}</span>
        <span>{sourceLabel(pending.source)}</span>
        <span>{es ? "Pago oficial" : "Official checkout"}</span>
      </div>
      <div className="token-gas-warning"><Warning weight="fill" /><span><strong>{es ? "Tú confirmas en la app oficial" : "You confirm in the official app"}</strong>{es
        ? pending.source === "robinhood"
          ? "IRIS solo abre Robinhood. La compra se completa con tu sesión y tu aprobación allí. IRIS no guarda tu contraseña."
          : "IRIS solo abre MetaMask o Uniswap. Tú firmas o pagas en esa ventana. IRIS no puede gastar sin esa confirmación."
        : pending.source === "robinhood"
          ? "IRIS only opens Robinhood. The purchase finishes with your Robinhood session and approval there. IRIS never stores your password."
          : "IRIS only opens MetaMask or Uniswap. You sign or pay in that window. IRIS cannot spend without that confirmation."}</span></div>
      <div className="approval-actions">
        <button disabled={busy} onClick={() => setPending(null)}>{es ? "Cancelar" : "Cancel"}</button>
        <button disabled={busy} onClick={() => void confirmApproval()}><CheckCircle />{busy ? (es ? "Abriendo…" : "Opening…") : (es ? `Aprobar y abrir ${sourceLabel(pending.source)}` : `Approve and open ${sourceLabel(pending.source)}`)}</button>
      </div>
    </section></div>}

    <div className="purchase-desk-head">
      <div><span>{es ? "COMPRAS AUTOMÁTICAS · SOLO CON TU OK" : "AUTOMATIC BUYS · YOUR OK ONLY"}</span><h3>{es ? "IRIS propone. Tú apruebas. MetaMask o Robinhood ejecutan." : "IRIS proposes. You approve. MetaMask or Robinhood execute."}</h3><p>{es ? "Programa compras diarias o semanales. IRIS avisa cuando toca. Nada se paga hasta que pulses aprobar." : "Schedule daily or weekly buys. IRIS alerts when it is time. Nothing is paid until you tap approve."}</p></div>
      <div className="purchase-official-links">
        <a href={ROBINHOOD_WALLET_URL} target="_blank" rel="noreferrer">{es ? "Wallet Robinhood" : "Robinhood Wallet"}<ArrowSquareOut /></a>
        <a href={ROBINHOOD_CONNECT_URL} target="_blank" rel="noreferrer">Robinhood Connect<ArrowSquareOut /></a>
      </div>
    </div>

    <form className="purchase-composer" onSubmit={event => { event.preventDefault(); void createPlan(); }}>
      <label><span>{es ? "Origen" : "Source"}</span>
        <select value={source} onChange={event => setSourceChoice(event.target.value as PurchaseSource)}>
          <option value="metamask">MetaMask</option>
          <option value="robinhood">Robinhood</option>
        </select>
      </label>
      <label><span>{es ? "Activo" : "Asset"}</span>
        <select value={asset} onChange={event => setAssetChoice(event.target.value as PurchaseAsset)}>
          {Object.values(PURCHASE_ASSETS).filter(item => (item.sources as readonly string[]).includes(source)).map(item => <option key={item.symbol} value={item.symbol}>{item.symbol} · {item.name}</option>)}
        </select>
      </label>
      <label><span>{es ? "Monto USD" : "USD amount"}</span><input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="25" /></label>
      <label><span>{es ? "Frecuencia" : "Cadence"}</span>
        <select value={cadence} onChange={event => setCadence(event.target.value as PurchaseCadence)}>
          <option value="once">{es ? "Una vez" : "Once"}</option>
          <option value="daily">{es ? "Diaria" : "Daily"}</option>
          <option value="weekly">{es ? "Semanal" : "Weekly"}</option>
        </select>
      </label>
      <button type="submit" disabled={busy}>{busy ? (es ? "Guardando…" : "Saving…") : (es ? "Programar compra" : "Schedule buy")}</button>
    </form>

    {waiting.length > 0 && <div className="purchase-waiting">
      <strong>{es ? "IRIS espera tu aprobación" : "IRIS is waiting for your approval"}</strong>
      {waiting.map(item => <article key={item.id}>
        <span>{item.source === "robinhood" ? <CurrencyBtc /> : <CurrencyEth />}</span>
        <div><b>${item.amountUsd} {item.asset}</b><small>{es ? "vía" : "via"} {sourceLabel(item.source)}</small></div>
        <button disabled={busy} onClick={() => void post({ action: "reject", proposalId: item.id })}>{es ? "Rechazar" : "Reject"}</button>
        <button disabled={busy} onClick={() => setPending(item)}>{es ? "Aprobar" : "Approve"}</button>
      </article>)}
    </div>}

    <div className="purchase-columns">
      <div>
        <h4>{es ? "Planes activos" : "Active plans"}</h4>
        {desk.plans.filter(item => item.status === "active" || item.status === "paused").map(plan => <article key={plan.id} className="purchase-plan">
          <div><b>${plan.amountUsd} {plan.asset}</b><small>{sourceLabel(plan.source)} · {plan.cadence === "daily" ? (es ? "cada día" : "daily") : plan.cadence === "weekly" ? (es ? "cada semana" : "weekly") : (es ? "una vez" : "once")}</small></div>
          <div className="purchase-plan-actions">
            <button disabled={busy} onClick={() => void post({ action: "propose_now", planId: plan.id })}>{es ? "Proponer ahora" : "Propose now"}</button>
            <button disabled={busy} onClick={() => void post({ action: "set_plan", planId: plan.id, status: plan.status === "paused" ? "active" : "paused" })}>{plan.status === "paused" ? (es ? "Reanudar" : "Resume") : (es ? "Pausar" : "Pause")}</button>
            <button disabled={busy} onClick={() => void post({ action: "set_plan", planId: plan.id, status: "cancelled" })}>{es ? "Cancelar" : "Cancel"}</button>
          </div>
        </article>)}
        {!desk.plans.some(item => item.status === "active" || item.status === "paused") && <p>{es ? "Todavía no hay un plan. Elige MetaMask o Robinhood y programa el primer monto." : "No plan yet. Choose MetaMask or Robinhood and schedule the first amount."}</p>}
      </div>
      <div>
        <h4>{es ? "Historial de aprobaciones" : "Approval history"}</h4>
        {history.map(item => <article key={item.id} className={`purchase-history ${item.status}`}>
          <CheckCircle /><div><b>${item.amountUsd} {item.asset}</b><small>{sourceLabel(item.source)} · {item.status}</small></div>
          {(item.status === "approved" || item.status === "opened") && <a href={item.checkoutUrl} target="_blank" rel="noreferrer"><ArrowSquareOut /></a>}
        </article>)}
        {!history.length && <p>{es ? "Cuando apruebes, IRIS abre la caja oficial y deja rastro aquí." : "When you approve, IRIS opens the official checkout and leaves a trail here."}</p>}
      </div>
    </div>
    {notice && <p className="chain-notice">{notice}</p>}
    <div className="purchase-live-hint"><Pulse /><span>{es ? "IRIS revisa los planes cada 20 segundos. Si toca comprar, te pide aprobación. Nunca inicia un pago sola." : "IRIS checks plans every 20 seconds. When a buy is due, it asks for approval. It never starts a payment alone."}</span></div>
  </section>;
}
