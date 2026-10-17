"use client";

/* eslint-disable react-hooks/set-state-in-effect -- phone debit loads wallet session and pending proposals */
import { useEffect, useState } from "react";
import { CheckCircle, DeviceMobile, ShieldCheck, Warning, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import type { WalletProvider } from "../../lib/iris-chain";
import { PHONE_DEBIT_ASSETS, PHONE_DEBIT_PRESETS, type PurchaseDeskState, type PurchaseProposal, type PurchaseSource } from "../../lib/iris-purchases";

const emptyDesk: PurchaseDeskState = { plans: [], proposals: [] };

function sourceLabel(source: PurchaseSource) {
  return source === "robinhood" ? "Robinhood" : "MetaMask";
}

export default function IrisPhoneDebit({ language }: { language: Language }) {
  const es = language === "es";
  const [desk, setDesk] = useState<PurchaseDeskState>(emptyDesk);
  const [asset, setAsset] = useState<"USDC" | "ETH">("USDC");
  const [amount, setAmount] = useState("25");
  const [wallet, setWallet] = useState("");
  const [walletMode, setWalletMode] = useState<WalletProvider>("watch");
  const source: PurchaseSource = walletMode === "robinhood" ? "robinhood" : "metamask";
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PurchaseProposal | null>(null);

  async function refresh() {
    const response = await fetch("/api/iris-purchases", { cache: "no-store" });
    if (response.ok) setDesk(await response.json() as PurchaseDeskState);
  }

  useEffect(() => {
    void refresh();
    void fetch("/api/wallet-session").then(response => response.ok ? response.json() : null).then((session: { connected?: boolean; address?: string; mode?: WalletProvider } | null) => {
      if (session?.connected && session.address) {
        setWallet(session.address);
        if (session.mode) setWalletMode(session.mode);
      }
    }).catch(() => undefined);
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/iris-purchases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as PurchaseDeskState & { error?: string; approved?: PurchaseProposal };
      if (!response.ok) throw new Error(payload.error || "debit");
      setDesk(payload);
      return payload;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (es ? "No se pudo guardar el débito." : "The debit could not be saved."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function requestDebit() {
    const created = await post({
      action: "create_plan",
      asset,
      amountUsd: amount,
      source,
      cadence: "once",
      destinationWallet: wallet,
    });
    if (created) setNotice(es ? "IRIS armó el débito. Nada se cobra hasta que apruebes." : "IRIS staged the debit. Nothing is charged until you approve.");
  }

  async function confirmApproval() {
    if (!pending) return;
    const result = await post({ action: "approve", proposalId: pending.id });
    if (!result?.approved) return;
    window.open(result.approved.checkoutUrl, "_blank", "noopener,noreferrer");
    await post({ action: "open", proposalId: result.approved.id });
    setPending(null);
    setNotice(es
      ? `Aprobado. Termina el pago en ${sourceLabel(result.approved.source)}. IRIS no mueve fondos.`
      : `Approved. Finish the payment in ${sourceLabel(result.approved.source)}. IRIS does not move funds.`);
  }

  const waiting = desk.proposals.filter(item => item.status === "awaiting_approval");

  return <section className="iris-phone-debit" aria-label={es ? "Débito del teléfono" : "Phone debit"}>
    {pending && <div className="approval-backdrop" role="presentation"><section className="approval-dialog purchase-approve-dialog" role="dialog" aria-modal="true" aria-labelledby="phone-debit-title">
      <button className="approval-close" aria-label={es ? "Cerrar" : "Close"} onClick={() => setPending(null)}><X /></button>
      <span className="approval-icon"><ShieldCheck weight="duotone" /></span>
      <p>{es ? "APROBACIÓN DEL USUARIO REQUERIDA" : "USER APPROVAL REQUIRED"}</p>
      <h2 id="phone-debit-title">{es ? "IRIS no debita sola" : "IRIS does not debit alone"}</h2>
      <div className="token-deploy-summary">
        <span><b>${pending.amountUsd}</b> {pending.asset}</span>
        <span>{sourceLabel(pending.source)}</span>
        <span>{es ? "Checkout oficial" : "Official checkout"}</span>
      </div>
      <div className="token-gas-warning"><Warning weight="fill" /><span><strong>{es ? "Tú confirmas en la app oficial" : "You confirm in the official app"}</strong>{es
        ? "IRIS solo abre MetaMask, Uniswap o Robinhood. El débito se completa allí, con tu sesión. No cobra tu línea de teléfono."
        : "IRIS only opens MetaMask, Uniswap, or Robinhood. The debit finishes there with your session. It does not charge your phone line."}</span></div>
      <div className="approval-actions">
        <button disabled={busy} onClick={() => setPending(null)}>{es ? "Cancelar" : "Cancel"}</button>
        <button disabled={busy} onClick={() => void confirmApproval()}><CheckCircle />{busy ? (es ? "Abriendo…" : "Opening…") : (es ? "Aprobar y abrir" : "Approve and open")}</button>
      </div>
    </section></div>}

    <div className="phone-debit-head">
      <DeviceMobile weight="duotone" />
      <div>
        <span>{es ? "DÉBITO · SOLO CON TU OK" : "DEBIT · YOUR OK ONLY"}</span>
        <h2>{es ? "Paga desde este teléfono" : "Pay from this phone"}</h2>
        <p>{es ? "Elige el monto. IRIS propone. Tú apruebas. MetaMask o Robinhood cobran. IRIS no tiene tu tarjeta ni tu número." : "Pick the amount. IRIS proposes. You approve. MetaMask or Robinhood charge. IRIS does not have your card or phone number."}</p>
      </div>
    </div>

    <div className="phone-debit-assets" role="group" aria-label={es ? "Activo" : "Asset"}>
      {PHONE_DEBIT_ASSETS.map(item => <button key={item} type="button" className={asset === item ? "active" : ""} onClick={() => setAsset(item)}>{item}</button>)}
    </div>

    <div className="phone-debit-presets" role="group" aria-label={es ? "Monto" : "Amount"}>
      {PHONE_DEBIT_PRESETS.map(preset => <button key={preset} type="button" className={amount === String(preset) ? "active" : ""} onClick={() => setAmount(String(preset))}>${preset}</button>)}
    </div>

    <label className="phone-debit-custom"><span>{es ? "Otro monto USD" : "Other USD amount"}</span>
      <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="25" />
    </label>

    <p className="phone-debit-source">{es ? "Se abre" : "Opens"} <strong>{sourceLabel(source)}</strong>{wallet ? ` · ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : (es ? " · conecta la wallet en IRIS Chain si quieres destino" : " · connect a wallet in IRIS Chain for a destination")}</p>

    <button className="phone-debit-submit" type="button" disabled={busy} onClick={() => void requestDebit()}>{busy ? (es ? "Guardando…" : "Saving…") : (es ? `Pedir débito de $${amount} ${asset}` : `Request $${amount} ${asset} debit`)}</button>

    {waiting.length > 0 && <div className="phone-debit-waiting">
      <strong>{es ? "Esperando tu aprobación" : "Waiting for your approval"}</strong>
      {waiting.map(item => <article key={item.id}>
        <div><b>${item.amountUsd} {item.asset}</b><small>{sourceLabel(item.source)}</small></div>
        <button disabled={busy} onClick={() => void post({ action: "reject", proposalId: item.id })}>{es ? "Rechazar" : "Reject"}</button>
        <button disabled={busy} onClick={() => setPending(item)}>{es ? "Aprobar" : "Approve"}</button>
      </article>)}
    </div>}

    {notice && <p className="chain-notice">{notice}</p>}
  </section>;
}
