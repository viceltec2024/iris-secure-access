/**
 * In-process isolated checks for Creator agent specs.
 * Never eval() user source, never touch the filesystem, never spawn shell.
 */

import {
  BLOCKED_CAPABILITIES,
  generateAgentSource,
  runGuardianChecks,
  type CreatedAgent,
  type SandboxCheck,
} from "./iris-creator.ts";

export type IsolatedRunResult = {
  ok: boolean;
  checks: SandboxCheck[];
  proposalSample: { type: string; requiresHumanApproval: true; applied: false; summary: string } | null;
  heartbeat: { ok: boolean; status: string; autonomy: "supervised" } | null;
  errors: string[];
  durationMs: number;
};

export function runIsolatedAgentSandbox(agent: CreatedAgent, language: "es" | "en" = "es"): IsolatedRunResult {
  const started = Date.now();
  const errors: string[] = [];
  const source = agent.sourcePreview || generateAgentSource(agent);
  const findings = runGuardianChecks({ ...agent, sourcePreview: source }, language);
  const blocked = findings.some(item => item.severity === "block");

  const enablesBlocked = BLOCKED_CAPABILITIES.some(cap => {
    const enabled = new RegExp(`${cap}\\s*[:=]\\s*true`, "i").test(source);
    const allowedInPrompt = new RegExp(`(permit|allow|habilita|permite).{0,40}${cap}`, "i").test(agent.prompt);
    return enabled || allowedInPrompt;
  });

  const checks: SandboxCheck[] = [
    {
      id: "no_eval",
      label: language === "es" ? "Sin eval/shell" : "No eval/shell",
      ok: !/\b(?:eval|Function)\s*\(|\bchild_process\b|\bDeno\.run\b|\bBun\.spawn\b/i.test(source),
      detail: language === "es" ? "El runner no ejecuta código arbitrario." : "The runner does not execute arbitrary code.",
    },
    {
      id: "no_self_modify",
      label: language === "es" ? "Sin auto-modificación" : "No self-modify",
      ok: !enablesBlocked,
      detail: language === "es" ? "self_modify_core y deploy siguen bloqueados." : "self_modify_core and deploy remain blocked.",
    },
    {
      id: "human_gate",
      label: language === "es" ? "Puerta humana" : "Human gate",
      ok: agent.guardian.requiresHumanApproval && agent.autonomy === "supervised" && !blocked,
      detail: blocked
        ? (language === "es" ? "Guardian bloqueó el spec." : "Guardian blocked the spec.")
        : (language === "es" ? "Solo propuestas supervisadas." : "Supervised proposals only."),
    },
    {
      id: "permissions",
      label: language === "es" ? "Permisos acotados" : "Bounded permissions",
      ok: agent.permissions.every(item => [
        "read_business_context",
        "draft_replies",
        "propose_actions",
        "propose_code_changes",
        "propose_tests",
        "notify_owner",
        "run_on_schedule",
      ].includes(item)),
      detail: language === "es" ? "Sin permisos peligrosos." : "No dangerous permissions.",
    },
  ];

  let proposalSample: IsolatedRunResult["proposalSample"] = null;
  let heartbeat: IsolatedRunResult["heartbeat"] = null;

  try {
    if (!agent.permissions.includes("propose_actions") && !agent.permissions.includes("propose_code_changes")) {
      throw new Error("permission_denied");
    }
    proposalSample = {
      type: "proposal",
      requiresHumanApproval: true,
      applied: false,
      summary: language === "es"
        ? `Propuesta aislada para ${agent.blueprint.specialty}`
        : `Isolated proposal for ${agent.blueprint.specialty}`,
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "proposal_failed");
  }

  try {
    if (agent.schedule === "always_on" && !agent.permissions.includes("run_on_schedule")) {
      heartbeat = { ok: false, status: "schedule_not_allowed", autonomy: "supervised" };
    } else {
      heartbeat = { ok: true, status: "heartbeat", autonomy: "supervised" };
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "heartbeat_failed");
  }

  const ok = checks.every(check => check.ok) && errors.length === 0 && Boolean(proposalSample?.requiresHumanApproval) && proposalSample?.applied === false;
  return {
    ok,
    checks,
    proposalSample,
    heartbeat,
    errors,
    durationMs: Date.now() - started,
  };
}
