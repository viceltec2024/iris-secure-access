/**
 * Vistas puras del Centro de misión: mission.yml y línea de tiempo con las
 * marcas de tiempo reales de la misión. Sin efectos ni datos inventados.
 */
import type { MissionRecord } from "./iris-mission.ts";

function yamlQuote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

export function missionYaml(mission: MissionRecord): string[] {
  const lines = [
    `mission: ${mission.id}`,
    `objective: ${yamlQuote(mission.objective)}`,
    `status: ${mission.status}`,
    `language: ${mission.language}`,
    `job: ${mission.jobId || "null"}`,
    `attempts: ${mission.attempts}/${mission.maxAttempts}`,
    `timeout_ms: ${mission.timeoutMs}`,
    "agent:",
    `  status: ${mission.agent?.status ?? "null"}`,
    `  autonomy: ${mission.agent?.autonomy ?? "null"}`,
    `  tools: [${(mission.agent?.blueprint?.tools || []).join(", ")}]`,
    "sandbox:",
    `  ok: ${mission.sandbox?.ok ?? "null"}`,
    `  isolation: ${mission.sandbox?.isolation?.level ?? "null"}`,
    `  claims_container_or_vm: ${mission.sandbox?.isolation?.claimsContainerOrVm ?? "null"}`,
    "verification:",
    `  passed: ${mission.verification?.passed ?? false}`,
    `  reasons: [${(mission.verification?.reasons || []).join(", ")}]`,
    "result:",
    "  applied_to_repo: false",
    "  self_modified_core: false",
    "  evidence:",
    ...(mission.result?.evidence || []).map(item => `    - ${yamlQuote(item)}`),
  ];
  if (mission.acceptedBy) lines.push(`accepted_by: ${mission.acceptedBy}`);
  if (mission.cancelledBy) lines.push(`cancelled_by: ${mission.cancelledBy}`);
  return lines;
}

/** Eventos de la misión con sus marcas de tiempo reales del servidor. */
export function missionTimeline(mission: MissionRecord, es: boolean) {
  const events: Array<{ at: string; kind: string; text: string; guard?: boolean }> = [
    { at: mission.createdAt, kind: "mission", text: `${es ? "en cola" : "queued"} · job ${mission.jobId || "—"}` },
  ];
  if (mission.status === "failed") {
    const block = mission.agent?.guardian?.findings?.find(item => item.severity === "block");
    events.push({ at: mission.updatedAt, kind: "guardian", text: `${es ? "bloqueó" : "blocked"} · ${block?.code || "sandbox_failed"} · ${es ? "nada aplicado" : "nothing applied"}`, guard: true });
  }
  if (mission.verifiedAt) events.push({ at: mission.verifiedAt, kind: "mission", text: `${es ? "verificada" : "verified"} · ${(mission.verification?.reasons || []).join(",")}` });
  if (mission.acceptedAt) events.push({ at: mission.acceptedAt, kind: "mission", text: `${es ? "aceptada" : "accepted"} · ${mission.acceptedBy || ""}` });
  if (mission.status === "rejected") events.push({ at: mission.updatedAt, kind: "mission", text: es ? "rechazada" : "rejected" });
  if (mission.cancelledAt) events.push({ at: mission.cancelledAt, kind: "mission", text: `${es ? "cancelada" : "cancelled"} · ${mission.cancelledBy || ""}` });
  return events.reverse();
}
