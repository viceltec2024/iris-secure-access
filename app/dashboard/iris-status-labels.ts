/**
 * Etiquetas honestas y localizadas para la web de IRIS.
 * Nunca inventa un estado live: "solo configurado" no es "probado en vivo",
 * y "aprobado" no es "activo 24/7": el tick es solo un latido supervisado.
 */

import type { Language } from "./dashboard-i18n";
import type { CreatedAgent } from "../../lib/iris-creator";
import type { MissionRecord } from "../../lib/iris-mission";
import type { ModelProviderStatus } from "../../lib/iris-model-registry";

export function agentStatusLabel(status: CreatedAgent["status"], es: boolean): string {
  const map: Record<CreatedAgent["status"], [string, string]> = {
    draft: ["Draft", "Borrador"],
    sandbox_passed: ["Sandbox passed", "Sandbox OK"],
    sandbox_failed: ["Sandbox failed", "Sandbox falló"],
    awaiting_approval: ["Awaiting approval", "Espera tu OK"],
    approved: ["Approved · supervised heartbeat", "Aprobado · latido supervisado"],
    rejected: ["Rejected", "Rechazado"],
    paused: ["Paused", "Pausado"],
    cancelled: ["Cancelled", "Cancelado"],
  };
  return map[status][es ? 1 : 0];
}

export function missionStatusLabel(item: MissionRecord, es: boolean): string {
  const base: Record<string, [string, string]> = {
    planned: ["Planned", "Planificada"],
    queued: ["Queued", "En cola"],
    executing: ["Executing", "Ejecutándose"],
    executed: ["Executed · awaiting human acceptance", "Ejecutada · espera aceptación humana"],
    awaiting_approval: ["Awaiting human acceptance", "Espera aceptación humana"],
    verified: ["Evidence verified · awaiting human acceptance", "Evidencia verificada · espera aceptación humana"],
    accepted: ["Accepted by human", "Aceptada por humano"],
    completed: ["Completed", "Completada"],
    rejected: ["Rejected", "Rechazada"],
    failed: ["Failed", "Falló"],
    cancelled: ["Cancelled", "Cancelada"],
  };
  const found = base[item.status];
  if (found) return found[es ? 1 : 0];
  return es ? "Pendiente" : "Pending";
}

export function providerStatusLabel(status: ModelProviderStatus["status"], es: boolean): string {
  const map: Record<ModelProviderStatus["status"], [string, string]> = {
    ready: ["Local ready", "Listo local"],
    configured_untested: ["Configured only · no live proof", "Solo configurado · sin prueba live"],
    missing: ["Not configured", "No configurado"],
    unavailable: ["Unavailable", "No disponible"],
  };
  return map[status][es ? 1 : 0];
}

/** Traduce códigos de error crudos de la API a mensajes comprensibles. */
export function friendlyError(raw: unknown, es: boolean): string {
  const code = raw instanceof Error ? raw.message : String(raw || "");
  const map: Record<string, [string, string]> = {
    mission: ["Could not start or update the mission. Try again.", "No se pudo iniciar o actualizar la misión. Inténtalo de nuevo."],
    evals: ["Could not run the evaluations. Try again.", "No se pudieron correr las evaluaciones. Inténtalo de nuevo."],
    lesson: ["Could not update the lesson. Try again.", "No se pudo actualizar la lección. Inténtalo de nuevo."],
    creator: ["Could not process the agent. Try again.", "No se pudo procesar el agente. Inténtalo de nuevo."],
    "voice unavailable": ["Voice is unavailable right now. The written answer is still available.", "La voz no está disponible ahora. La respuesta escrita sigue disponible."],
  };
  const found = map[code];
  if (found) return found[es ? 1 : 0];
  if (code && code.length < 200) return code;
  return es ? "Algo salió mal. Inténtalo de nuevo." : "Something went wrong. Try again.";
}

export type { Language };
