/**
 * IRIS Etapa 4 — Herramientas con evidencia.
 *
 * Planificador determinista y sin ejecución real: elige herramientas por
 * objetivo, costo y riesgo, exige permiso por herramienta, y solo deja
 * ejecutar a agentes aprobados. La ejecución en sí la hace el llamador a
 * través de un `executor` que recibe cada paso ya autorizado; este
 * módulo nunca llama a shell, red, despliegue, gasto ni push, y nunca
 * ejecuta nada por su cuenta.
 *
 * Reglas duras (heredadas de lib/iris-tool-acl.ts, que no se toca):
 *   - Herramientas prohibidas (exec_shell, deploy, gasto, push,
 *     modificación del core, exfiltración) nunca se planifican ni se
 *     ejecutan: un objetivo que las pida se rechaza entero.
 *   - Cada paso pasa por authorizeTool antes de ejecutarse. Un paso sin
 *     permiso humano cuando lo exige queda "blocked_approval_required"
 *     y su executor NO se llama.
 *   - Un agente no aprobado no ejecuta herramientas sensibles; solo
 *     lectura y sandbox, como ya decide authorizeTool.
 *   - Ante un fallo del executor, la cadena se detiene de forma segura:
 *     los pasos restantes quedan "not_run_safe_stop" y el plan termina
 *     en "failed_safe", nunca a medias y en silencio.
 *   - Cada paso deja evidencia: id estable, herramienta, estado y un
 *     detalle saneado (cualquier patrón de clave se redacta).
 */

import {
  authorizeTool,
  IRIS_TOOLS,
  type IrisToolId,
} from "./iris-tool-acl.ts";

export type ToolRisk = "bajo" | "medio" | "alto";

export type ToolCatalogEntry = {
  tool: IrisToolId;
  /** Costo relativo 1 (barato) a 3 (caro), para ordenar el plan. */
  cost: number;
  risk: ToolRisk;
  readOnly: boolean;
  requiresHumanApproval: boolean;
  /** Palabras del objetivo que hacen candidata a esta herramienta. */
  keywords: string[];
};

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { tool: "business_context", cost: 1, risk: "bajo", readOnly: true, requiresHumanApproval: false, keywords: ["contexto", "negocio", "empresa", "resumen", "context"] },
  { tool: "memory_read", cost: 1, risk: "bajo", readOnly: true, requiresHumanApproval: false, keywords: ["memoria", "leccion", "lecciones", "aprendizaje", "recuerdo", "memory", "lesson"] },
  { tool: "provider_status", cost: 1, risk: "bajo", readOnly: true, requiresHumanApproval: false, keywords: ["proveedor", "estado", "disponible", "clave", "provider", "status", "listo"] },
  { tool: "policy_sandbox", cost: 1, risk: "bajo", readOnly: true, requiresHumanApproval: false, keywords: ["sandbox", "simular", "probar", "validar", "seguro", "sandbox", "simulate"] },
  { tool: "mission_plan", cost: 2, risk: "medio", readOnly: false, requiresHumanApproval: false, keywords: ["mision", "plan", "planificar", "objetivo", "mission", "plan"] },
  { tool: "draft_composer", cost: 2, risk: "medio", readOnly: false, requiresHumanApproval: false, keywords: ["borrador", "redactar", "escribir", "texto", "draft", "componer"] },
  { tool: "proposal_queue", cost: 2, risk: "medio", readOnly: false, requiresHumanApproval: true, keywords: ["propuesta", "cola", "proponer", "codigo", "proposal", "queue"] },
  { tool: "owner_notifier", cost: 2, risk: "medio", readOnly: false, requiresHumanApproval: true, keywords: ["avisar", "notificar", "propietario", "mensaje", "notify", "owner"] },
  { tool: "memory_append", cost: 3, risk: "alto", readOnly: false, requiresHumanApproval: true, keywords: ["guardar", "recordar", "anotar", "memoria", "aprender", "save", "remember"] },
];

const RISK_ORDER: Record<ToolRisk, number> = { bajo: 0, medio: 1, alto: 2 };

/** Objetivos que nunca se planifican: shell, deploy, gasto, push, core. */
export const FORBIDDEN_OBJECTIVE = /\b(exec_shell|shell|desplegar|deploy|producci[oó]n|push|gastar|gasto|pagar|comprar|modific\w*\s+el\s+n[uú]cleo|self[\s_-]?modif|exfiltrar|secretos|credenciales|api[_-]?key)\b/i;

export function isForbiddenObjective(objective: string): boolean {
  return FORBIDDEN_OBJECTIVE.test(String(objective || ""));
}

export type PlannedStep = {
  index: number;
  tool: IrisToolId;
  cost: number;
  risk: ToolRisk;
  requiresHumanApproval: boolean;
  humanApproved: boolean;
  matchedKeywords: string[];
};

export type ToolPlan = {
  planId: string;
  objective: string;
  agentStatus: string;
  steps: PlannedStep[];
  totalCost: number;
  maxRisk: ToolRisk | null;
  rejected: boolean;
  rejectReason: string | null;
};

function normalizeObjectiveText(objective: string): string {
  return String(objective || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n");
}

/**
 * Planifica: puntúa cada herramienta por palabras coincidentes con el
 * objetivo y ordena por coincidencias (más primero), riesgo (menor
 * primero) y costo (menor primero). Máximo 3 pasos, solo herramientas
 * con al menos una coincidencia. Sin coincidencias, el plan queda vacío
 * con rejectReason "no_tool_matches_objective" (honesto, no inventado).
 */
export function planTools(input: {
  planId: string;
  objective: string;
  agentStatus?: string;
  /** Permiso humano por herramienta, no un permiso general. */
  approvedTools?: readonly string[];
  maxSteps?: number;
}): ToolPlan {
  const objective = String(input.objective || "").trim();
  const agentStatus = input.agentStatus || "";
  const approved = new Set(input.approvedTools || []);
  if (!objective) {
    return { planId: input.planId, objective, agentStatus, steps: [], totalCost: 0, maxRisk: null, rejected: true, rejectReason: "empty_objective" };
  }
  if (isForbiddenObjective(objective)) {
    return { planId: input.planId, objective, agentStatus, steps: [], totalCost: 0, maxRisk: null, rejected: true, rejectReason: "forbidden_objective" };
  }
  const normalized = normalizeObjectiveText(objective);
  const scored = TOOL_CATALOG.map(entry => {
    const matched = entry.keywords.filter(keyword => normalized.includes(normalizeObjectiveText(keyword)));
    return { entry, matched };
  }).filter(item => item.matched.length > 0);
  scored.sort((a, b) => {
    if (b.matched.length !== a.matched.length) return b.matched.length - a.matched.length;
    if (RISK_ORDER[a.entry.risk] !== RISK_ORDER[b.entry.risk]) return RISK_ORDER[a.entry.risk] - RISK_ORDER[b.entry.risk];
    return a.entry.cost - b.entry.cost;
  });
  const maxSteps = Math.max(1, Math.min(3, input.maxSteps ?? 3));
  const steps: PlannedStep[] = scored.slice(0, maxSteps).map((item, index) => ({
    index,
    tool: item.entry.tool,
    cost: item.entry.cost,
    risk: item.entry.risk,
    requiresHumanApproval: item.entry.requiresHumanApproval,
    humanApproved: approved.has(item.entry.tool),
    matchedKeywords: item.matched,
  }));
  if (!steps.length) {
    return { planId: input.planId, objective, agentStatus, steps: [], totalCost: 0, maxRisk: null, rejected: true, rejectReason: "no_tool_matches_objective" };
  }
  const totalCost = steps.reduce((sum, step) => sum + step.cost, 0);
  const maxRisk = steps.reduce<ToolRisk>((acc, step) => (RISK_ORDER[step.risk] > RISK_ORDER[acc] ? step.risk : acc), "bajo");
  return { planId: input.planId, objective, agentStatus, steps, totalCost, maxRisk, rejected: false, rejectReason: null };
}

export type StepEvidence = {
  evidenceId: string;
  tool: string;
  status: "executed" | "blocked_approval_required" | "blocked_acl" | "failed" | "not_run_safe_stop";
  reason: string;
  detail: string;
};

export type ExecutedPlan = {
  planId: string;
  objective: string;
  state: "completed" | "partial" | "blocked" | "failed_safe" | "rejected";
  evidence: StepEvidence[];
};

/** Redacta patrones de secreto en detalles de evidencia (nunca en logs). */
export function sanitizeEvidenceDetail(detail: string): string {
  return String(detail || "")
    .replace(/sk-[A-Za-z0-9_-]{4,}/g, "[redacted]")
    .replace(/api[_-]?key\s*[:=]\s*\S+/gi, "api_key: [redacted]")
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .slice(0, 1000);
}

/**
 * Ejecuta un plan ya construido. El executor solo se llama para pasos que
 * authorizeTool permite; cualquier otro paso queda bloqueado con su
 * motivo. Si el executor lanza, la cadena se detiene de forma segura.
 * Síncrono a propósito: sin promesas ni efectos fuera del executor del
 * llamador, que es quien decide qué significa "ejecutar" cada herramienta.
 */
export function executeToolPlan(
  plan: ToolPlan,
  executor: (step: PlannedStep) => string,
  options?: { allowedTools?: readonly string[] },
): ExecutedPlan {
  if (plan.rejected || !plan.steps.length) {
    return { planId: plan.planId, objective: plan.objective, state: "rejected", evidence: [] };
  }
  const evidence: StepEvidence[] = [];
  let failed = false;
  let blocked = false;
  let executed = 0;
  for (const step of plan.steps) {
    const evidenceId = `ev-${plan.planId}-${step.index}`;
    if (failed) {
      evidence.push({ evidenceId, tool: step.tool, status: "not_run_safe_stop", reason: "previous_step_failed", detail: "" });
      continue;
    }
    const decision = authorizeTool({
      tool: step.tool,
      allowedTools: options?.allowedTools,
      agentStatus: plan.agentStatus || undefined,
      humanApproved: step.humanApproved || undefined,
    });
    if (!decision.allowed) {
      blocked = true;
      evidence.push({
        evidenceId,
        tool: step.tool,
        status: decision.reason === "human_approval_required" ? "blocked_approval_required" : "blocked_acl",
        reason: decision.reason,
        detail: "",
      });
      continue;
    }
    try {
      const detail = executor(step);
      executed += 1;
      evidence.push({ evidenceId, tool: step.tool, status: "executed", reason: decision.reason, detail: sanitizeEvidenceDetail(detail) });
    } catch (error) {
      failed = true;
      evidence.push({
        evidenceId,
        tool: step.tool,
        status: "failed",
        reason: "executor_failed",
        detail: sanitizeEvidenceDetail(error instanceof Error ? error.message : "executor_failed"),
      });
    }
  }
  const state = failed
    ? "failed_safe"
    : executed === plan.steps.length
      ? "completed"
      : executed > 0
        ? "partial"
        : "blocked";
  void blocked;
  return { planId: plan.planId, objective: plan.objective, state, evidence };
}

export function catalogToolIds(): IrisToolId[] {
  return [...IRIS_TOOLS];
}
