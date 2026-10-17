"use client";

/* eslint-disable react-hooks/set-state-in-effect -- org panel loads membership + usage on mount */
import { useEffect, useState } from "react";
import { Buildings, CheckCircle, UsersThree, Warning } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";

type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  role: string;
  budgetCentsMonthly: number;
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

type MemberRow = {
  id: string;
  userEmail: string;
  role: string;
  status: string;
};

type OrgsPayload = {
  activeOrganizationId?: string;
  organizations?: OrgSummary[];
  usage?: UsageSnapshot;
  limits?: PlanLimits;
  members?: MemberRow[];
  billing?: { chargeEnabled: boolean; note: string };
  error?: string;
};

export default function IrisOrgPanel({ language }: { language: Language }) {
  const es = language === "es";
  const [payload, setPayload] = useState<OrgsPayload>({});
  const [name, setName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("OPERATOR");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function refresh() {
    const response = await fetch("/api/iris-orgs?view=members", { cache: "no-store" });
    if (response.ok) setPayload(await response.json() as OrgsPayload);
  }

  useEffect(() => {
    void refresh();
  }, []);

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

  return <section className="module-panel iris-org-panel">
    <div className="module-toolbar">
      <div>
        <h2>{es ? "Organización · IRIS SaaS" : "Organization · IRIS SaaS"}</h2>
        <p>{es
          ? "Administra empresas, roles, plan y consumo. Los pagos están desactivados hasta tu autorización."
          : "Manage companies, roles, plan, and usage. Payments stay off until you authorize them."}</p>
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
          </div>
          {payload.billing?.note && <p className="iris-org-note">{payload.billing.note}</p>}
        </> : <p>{es ? "Cargando…" : "Loading…"}</p>}

        <h3>{es ? "Consumo del mes" : "Monthly usage"}</h3>
        {usage && limits ? <ul className="creator-findings">
          <li>{es ? "Solicitudes" : "Requests"}: {usage.requests} / {limits.maxRequestsPerMonth}</li>
          <li>{es ? "Misiones" : "Missions"}: {usage.missions} / {limits.maxMissionsPerMonth}</li>
          <li>{es ? "Tokens" : "Tokens"}: {usage.tokensIn + usage.tokensOut} / {limits.maxTokensPerMonth}</li>
          <li>{es ? "Costo estimado" : "Est. cost"}: ${(usage.estimatedCostCents / 100).toFixed(2)}</li>
          <li>{es ? "Ejecuciones de agente" : "Agent runs"}: {usage.agentRuns}</li>
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
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={es ? "Nombre de la empresa" : "Company name"}
            disabled={busy}
          />
          <button type="button" disabled={busy || name.trim().length < 2} onClick={() => void post({ action: "create", name }).then(result => {
            if (result) {
              setName("");
              setNotice(es ? "Organización creada." : "Organization created.");
            }
          })}>
            {es ? "Crear" : "Create"}
          </button>
        </div>
      </div>

      <aside className="module-detail">
        <h3><UsersThree weight="duotone" /> {es ? "Miembros" : "Members"}</h3>
        <ul className="creator-findings">
          {(payload.members || []).map(member => (
            <li key={member.id}>
              <CheckCircle weight="fill" /> {member.userEmail} · {member.role}
            </li>
          ))}
          {!payload.members?.length && <li>{es ? "Sin miembros cargados" : "No members loaded"}</li>}
        </ul>

        <h3>{es ? "Invitar miembro" : "Invite member"}</h3>
        <div className="creator-compose">
          <input
            value={memberEmail}
            onChange={event => setMemberEmail(event.target.value)}
            placeholder="email@empresa.com"
            disabled={busy}
          />
          <select value={memberRole} onChange={event => setMemberRole(event.target.value)} disabled={busy}>
            <option value="ADMIN">ADMIN</option>
            <option value="OPERATOR">OPERATOR</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <button type="button" disabled={busy || !memberEmail.includes("@")} onClick={() => void post({
            action: "add_member",
            email: memberEmail,
            role: memberRole,
          }).then(result => {
            if (result) {
              setMemberEmail("");
              setNotice(es ? "Miembro añadido." : "Member added.");
            }
          })}>
            {es ? "Añadir" : "Add"}
          </button>
        </div>

        {notice && <p className="iris-org-notice"><Warning weight="fill" /> {notice}</p>}
      </aside>
    </div>
  </section>;
}
