"use client";

/* eslint-disable react-hooks/set-state-in-effect -- org panel loads membership + usage on mount */
import { useEffect, useState } from "react";
import { Buildings, CheckCircle, Key, Warning } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";

type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  role: string;
  budgetCentsMonthly: number;
  billingMode?: string;
  subscriptionStatus?: string;
};

type UsageSnapshot = {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  missions: number;
  agentRuns: number;
  estimatedCostCents: number;
};

type PlanLimits = {
  label: string;
  maxAgents: number;
  maxMissionsPerMonth: number;
  maxRequestsPerMonth: number;
  maxTokensPerMonth: number;
  defaultBudgetCents: number;
};

type MemberRow = { id: string; userEmail: string; role: string; status: string };
type InviteRow = { id: string; email: string; role: string; status: string; tokenPrefix: string; expiresAt: string };
type ApiKeyRow = { id: string; name: string; keyPrefix: string; scopes: string[]; revokedAt: string | null };
type BillingInfo = {
  chargeEnabled: boolean;
  testMode?: boolean;
  mode?: string;
  note: string;
  stripeKeyKind?: string;
};
type ProviderSecret = { id: string; label: string; status: string; detail: string };
type ObsSummary = {
  windowHours: number;
  askCount: number;
  askP50Ms: number | null;
  askP95Ms: number | null;
  guardianBlocks: number;
  agentTicks: number;
  providerProbes: number;
  evalRuns: number;
};
type ProbeRow = { id: string; status: string; detail?: string };

type OrgsPayload = {
  activeOrganizationId?: string;
  organizations?: OrgSummary[];
  usage?: UsageSnapshot;
  limits?: PlanLimits;
  members?: MemberRow[];
  invites?: InviteRow[];
  apiKeys?: ApiKeyRow[];
  billing?: BillingInfo;
  billingEvents?: Array<{ id: string; kind: string; plan: string | null; amountCents: number; createdAt: string }>;
  providerSecrets?: { providers: ProviderSecret[]; notes: string[] };
  observability?: ObsSummary;
  error?: string;
  acceptToken?: string;
  secret?: string;
  checkout?: { checkoutSessionId: string; plan: string; amountCents: number };
  confirmed?: { plan: string; charged: boolean };
};

export default function IrisOrgPanel({ language }: { language: Language }) {
  const es = language === "es";
  const [payload, setPayload] = useState<OrgsPayload>({});
  const [name, setName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("OPERATOR");
  const [inviteToken, setInviteToken] = useState("");
  const [keyName, setKeyName] = useState("");
  const [planPick, setPlanPick] = useState("business");
  const [oneTimeSecret, setOneTimeSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [probes, setProbes] = useState<ProbeRow[]>([]);

  async function refresh() {
    const response = await fetch(`/api/iris-orgs?view=admin&language=${language}`, { cache: "no-store" });
    if (response.ok) setPayload(await response.json() as OrgsPayload);
  }

  useEffect(() => {
    void refresh();
    // Refresh closes over language for provider secret labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/iris-orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json() as OrgsPayload & { error?: string };
      if (!response.ok) throw new Error(data.error || "org");
      if (data.acceptToken) setOneTimeSecret(data.acceptToken);
      if (data.secret) setOneTimeSecret(data.secret);
      await refresh();
      return data;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (es ? "No se pudo completar la acción." : "Action failed."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const active = payload.organizations?.find(item => item.id === payload.activeOrganizationId);
  const usage = payload.usage;
  const limits = payload.limits;
  const canAdmin = active?.role === "OWNER" || active?.role === "ADMIN";

  return <section className="module-panel iris-org-panel">
    <div className="module-toolbar">
      <div>
        <h2>{es ? "Organización · IRIS SaaS" : "Organization · IRIS SaaS"}</h2>
        <p>{es
          ? "Invitaciones, roles, claves API (hash) y billing en modo prueba. Cobros reales desactivados."
          : "Invites, roles, hashed API keys, and test billing. Real charges stay off."}</p>
      </div>
      <span className="audit-total"><Buildings weight="duotone" /> {payload.organizations?.length || 0}</span>
    </div>

    <div className="module-split">
      <div className="module-detail">
        <h3>{es ? "Organización activa" : "Active organization"}</h3>
        {active ? <>
          <h2>{active.name}</h2>
          <p>{active.slug} · {active.plan.toUpperCase()} · {active.role} · {active.status}</p>
          <div className="token-deploy-summary">
            <span><b>{es ? "Presupuesto" : "Budget"}</b> ${(active.budgetCentsMonthly / 100).toFixed(2)} / mes</span>
            <span><b>{es ? "Cobros" : "Billing"}</b> {payload.billing?.chargeEnabled ? "ON" : "OFF"}</span>
            <span><b>Mode</b> {payload.billing?.mode || "off"}</span>
            <span><b>Sub</b> {active.subscriptionStatus || "none"}</span>
          </div>
          {payload.billing?.note && <p className="iris-org-note">{payload.billing.note}</p>}
        </> : <p>{es ? "Cargando…" : "Loading…"}</p>}

        <h3>{es ? "Consumo del mes" : "Monthly usage"}</h3>
        {usage && limits ? <ul className="creator-findings">
          <li>{es ? "Solicitudes" : "Requests"}: {usage.requests} / {limits.maxRequestsPerMonth}</li>
          <li>{es ? "Misiones" : "Missions"}: {usage.missions} / {limits.maxMissionsPerMonth}</li>
          <li>{es ? "Tokens" : "Tokens"}: {usage.tokensIn + usage.tokensOut} / {limits.maxTokensPerMonth}</li>
          <li>{es ? "Costo estimado" : "Est. cost"}: ${(usage.estimatedCostCents / 100).toFixed(2)}</li>
        </ul> : null}

        <h3>{es ? "Cambiar de organización" : "Switch organization"}</h3>
        <div className="iris-org-list">
          {(payload.organizations || []).map(org => (
            <button
              key={org.id}
              type="button"
              className={org.id === payload.activeOrganizationId ? "active" : ""}
              disabled={busy || org.id === payload.activeOrganizationId}
              onClick={() => void post({ action: "switch", organizationId: org.id })}
            >
              <strong>{org.name}</strong>
              <span>{org.plan} · {org.role}</span>
            </button>
          ))}
        </div>

        <h3>{es ? "Crear organización" : "Create organization"}</h3>
        <div className="creator-compose">
          <input value={name} onChange={event => setName(event.target.value)} placeholder={es ? "Nombre de la empresa" : "Company name"} disabled={busy} />
          <button type="button" disabled={busy || name.trim().length < 2} onClick={() => void post({ action: "create", name }).then(result => {
            if (result) { setName(""); setNotice(es ? "Organización creada." : "Organization created."); }
          })}>{es ? "Crear" : "Create"}</button>
        </div>

        <h3>{es ? "Aceptar invitación" : "Accept invite"}</h3>
        <div className="creator-compose">
          <input value={inviteToken} onChange={event => setInviteToken(event.target.value)} placeholder="iris_inv_…" disabled={busy} />
          <button type="button" disabled={busy || !inviteToken.startsWith("iris_inv_")} onClick={() => void post({ action: "accept_invite", token: inviteToken }).then(result => {
            if (result) { setInviteToken(""); setNotice(es ? "Invitación aceptada." : "Invite accepted."); }
          })}>{es ? "Aceptar" : "Accept"}</button>
        </div>

        {canAdmin && <>
          <h3>{es ? "Billing prueba (sin cobro)" : "Test billing (no charge)"}</h3>
          <div className="creator-compose">
            <select value={planPick} onChange={event => setPlanPick(event.target.value)} disabled={busy}>
              <option value="starter">Starter</option>
              <option value="business">Business</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <button type="button" disabled={busy} onClick={() => void post({ action: "billing_test_start", plan: planPick }).then(result => {
              if (!result?.checkout) return;
              setNotice(es
                ? `Checkout test ${result.checkout.checkoutSessionId}. Confirma para aplicar el plan sin cobrar.`
                : `Test checkout ${result.checkout.checkoutSessionId}. Confirm to apply plan without charging.`);
              void post({ action: "billing_test_confirm", plan: planPick, checkoutSessionId: result.checkout.checkoutSessionId });
            })}>{es ? "Simular plan test" : "Simulate test plan"}</button>
          </div>
          {(payload.billingEvents || []).slice(0, 4).map(event => (
            <p key={event.id} className="iris-org-note">{event.kind} · {event.plan || "—"} · ${(event.amountCents / 100).toFixed(2)}</p>
          ))}
        </>}
      </div>

      <aside className="module-detail">
        <h3>{es ? "Miembros y roles" : "Members and roles"}</h3>
        <ul className="creator-findings iris-org-members">
          {(payload.members || []).map(member => (
            <li key={member.id}>
              <CheckCircle weight="fill" />
              <span>{member.userEmail} · {member.role}</span>
              {canAdmin && member.role !== "OWNER" && <>
                <select
                  aria-label={es ? "Rol" : "Role"}
                  value={member.role}
                  disabled={busy}
                  onChange={event => void post({ action: "update_role", email: member.userEmail, role: event.target.value })}
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="OPERATOR">OPERATOR</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
                <button type="button" disabled={busy} onClick={() => void post({ action: "remove_member", email: member.userEmail })}>{es ? "Quitar" : "Remove"}</button>
              </>}
            </li>
          ))}
        </ul>

        <h3>{es ? "Invitar por email" : "Invite by email"}</h3>
        <div className="creator-compose">
          <input value={memberEmail} onChange={event => setMemberEmail(event.target.value)} placeholder="email@empresa.com" disabled={busy || !canAdmin} />
          <select value={memberRole} onChange={event => setMemberRole(event.target.value)} disabled={busy || !canAdmin}>
            <option value="ADMIN">ADMIN</option>
            <option value="OPERATOR">OPERATOR</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <button type="button" disabled={busy || !canAdmin || !memberEmail.includes("@")} onClick={() => void post({
            action: "invite",
            email: memberEmail,
            role: memberRole,
          }).then(result => {
            if (result) {
              setMemberEmail("");
              setNotice(es ? "Invitación creada. Copia el token (solo una vez)." : "Invite created. Copy the token (once).");
            }
          })}>{es ? "Invitar" : "Invite"}</button>
        </div>
        <ul className="creator-findings">
          {(payload.invites || []).filter(item => item.status === "PENDING").map(invite => (
            <li key={invite.id}>
              {invite.email} · {invite.role} · {invite.tokenPrefix}…
              {canAdmin && <button type="button" disabled={busy} onClick={() => void post({ action: "revoke_invite", inviteId: invite.id })}>{es ? "Revocar" : "Revoke"}</button>}
            </li>
          ))}
        </ul>

        <h3><Key weight="duotone" /> {es ? "Claves API de organización" : "Organization API keys"}</h3>
        <p className="iris-org-note">{es
          ? "IRIS guarda solo el hash. El secreto se muestra una vez."
          : "IRIS stores only the hash. The secret is shown once."}</p>
        <div className="creator-compose">
          <input value={keyName} onChange={event => setKeyName(event.target.value)} placeholder={es ? "Nombre de la clave" : "Key name"} disabled={busy || !canAdmin} />
          <button type="button" disabled={busy || !canAdmin || keyName.trim().length < 2} onClick={() => void post({
            action: "create_api_key",
            name: keyName,
            scopes: ["read", "missions"],
          }).then(result => {
            if (result) {
              setKeyName("");
              setNotice(es ? "Clave creada. Guarda el secreto ahora." : "Key created. Save the secret now.");
            }
          })}>{es ? "Crear clave" : "Create key"}</button>
        </div>
        <ul className="creator-findings">
          {(payload.apiKeys || []).map(key => (
            <li key={key.id}>
              {key.name} · {key.keyPrefix}… · {(key.scopes || []).join(",")}
              {!key.revokedAt && canAdmin && <button type="button" disabled={busy} onClick={() => void post({ action: "revoke_api_key", keyId: key.id })}>{es ? "Revocar" : "Revoke"}</button>}
              {key.revokedAt && <em>{es ? "revocada" : "revoked"}</em>}
            </li>
          ))}
        </ul>

        <h3>{es ? "Secretos de plataforma (presencia)" : "Platform secrets (presence)"}</h3>
        <ul className="creator-findings">
          {(payload.providerSecrets?.providers || []).map(provider => (
            <li key={provider.id}>{provider.label}: {provider.status}</li>
          ))}
        </ul>
        {(payload.providerSecrets?.notes || []).map(note => <p key={note} className="iris-org-note">{note}</p>)}

        {canAdmin && <div className="iris-readiness-board">
          <strong>{es ? "Sonda honesta de proveedores" : "Honest provider probe"}</strong>
          <button type="button" disabled={busy} onClick={() => {
            setBusy(true);
            void fetch("/api/iris-providers/status?probe=1", { cache: "no-store" })
              .then(async response => {
                const data = await response.json() as { probes?: { providers?: ProbeRow[] }; error?: string };
                if (!response.ok) throw new Error(data.error || "probe");
                setProbes(data.probes?.providers || []);
                setNotice(es
                  ? "Sonda lista. Clave configurada ≠ live_ok."
                  : "Probe ready. Configured key ≠ live_ok.");
                await refresh();
              })
              .catch(error => setNotice(error instanceof Error ? error.message : "probe"))
              .finally(() => setBusy(false));
          }}>{es ? "Probar proveedores" : "Probe providers"}</button>
          <ul>
            {probes.map(item => <li key={item.id}><span>{item.id}</span><em data-live={item.status === "live_ok" || item.status === "local_ready" ? "ok" : item.status.includes("skip") || item.status.includes("missing") ? "missing" : "partial"}>{item.status}</em></li>)}
          </ul>
        </div>}

        {payload.observability && <div className="iris-obs-board">
          <strong>{es ? "Observabilidad (24h)" : "Observability (24h)"}</strong>
          <ul>
            <li><span>{es ? "Ask p50 / p95" : "Ask p50 / p95"}</span><b>{payload.observability.askP50Ms ?? "—"} / {payload.observability.askP95Ms ?? "—"} ms</b></li>
            <li><span>{es ? "Bloqueos Guardian" : "Guardian blocks"}</span><b>{payload.observability.guardianBlocks}</b></li>
            <li><span>{es ? "Latidos de agente" : "Agent ticks"}</span><b>{payload.observability.agentTicks}</b></li>
            <li><span>{es ? "Sondas / evals" : "Probes / evals"}</span><b>{payload.observability.providerProbes} / {payload.observability.evalRuns}</b></li>
          </ul>
        </div>}

        {canAdmin && <div className="creator-compose">
          <button type="button" disabled={busy} onClick={() => void post({ action: "export" }).then(result => {
            if (!result) return;
            const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `iris-org-export-${payload.activeOrganizationId || "org"}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            setNotice(es ? "Export compliance descargado (sin secretos)." : "Compliance export downloaded (no secrets).");
          })}>{es ? "Exportar compliance JSON" : "Export compliance JSON"}</button>
        </div>}

        {oneTimeSecret && <div className="iris-org-onetime">
          <Warning weight="fill" />
          <div>
            <strong>{es ? "Secreto de un solo uso" : "One-time secret"}</strong>
            <code>{oneTimeSecret}</code>
            <button type="button" onClick={() => setOneTimeSecret("")}>{es ? "Ocultar" : "Hide"}</button>
          </div>
        </div>}

        {notice && <p className="iris-org-notice"><Warning weight="fill" /> {notice}</p>}
      </aside>
    </div>
  </section>;
}
