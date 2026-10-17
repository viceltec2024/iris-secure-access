/**
 * IRIS central coordinator: routes tasks to models/tools, tracks agent lifecycle,
 * and drives the job queue. Does not auto-apply code or deploy.
 */

import { routeIrisTextRequest, routeIrisVoice, listProviderStatus, type IrisRouteDecision } from "./iris-model-router.ts";
import { authorizeTool, defaultToolsForAgent, type ToolAclDecision } from "./iris-tool-acl.ts";
import { queueStats, type JobQueueState } from "./iris-job-queue.ts";
import type { CreatorDeskState } from "./iris-creator.ts";
import type { MissionDesk } from "./iris-mission.ts";

export type CoordinatorTaskKind = "ask" | "edit" | "voice" | "mission" | "creator" | "probe";

export type CoordinatorDecision = {
  task: CoordinatorTaskKind;
  route: IrisRouteDecision | null;
  tool: ToolAclDecision | null;
  isolation: {
    level: "worker_request_isolate+policy_sandbox";
    claimsContainerOrVm: false;
    claimsOsShell: false;
  };
  humanGateRequired: boolean;
  notes: string[];
};

export type CoordinatorSnapshot = {
  generatedAt: string;
  providers: ReturnType<typeof listProviderStatus>;
  voice: IrisRouteDecision;
  agents: {
    total: number;
    approved: number;
    paused: number;
    awaitingApproval: number;
    cancelled: number;
  };
  missions: {
    total: number;
    awaitingApproval: number;
    verified: number;
    failed: number;
    cancelled: number;
  };
  queue: ReturnType<typeof queueStats>;
  isolationClaim: string;
};

export function classifyCoordinatorTask(question: string): CoordinatorTaskKind {
  const text = question.trim();
  if (/\b(voz|habla|speak|tts|elevenlabs)\b/i.test(text)) return "voice";
  if (/\b(misi[oó]n|mission|objetivo)\b/i.test(text)) return "mission";
  if (/\b(crea(?:r)?|create).{0,40}\b(agente|agent)\b/i.test(text)) return "creator";
  if (/\b(proveedor|provider|openai|muse|elevenlabs)\b/i.test(text)) return "probe";
  const route = routeIrisTextRequest({ question: text });
  if (route.kind === "edit") return "edit";
  return "ask";
}

export function decideCoordinatorTask(input: {
  question: string;
  env?: Record<string, string | undefined>;
  agentStatus?: string;
  humanApproved?: boolean;
}): CoordinatorDecision {
  const task = classifyCoordinatorTask(input.question);
  const env = input.env || {};
  const notes: string[] = [];
  let route: IrisRouteDecision | null = null;
  let tool: ToolAclDecision | null = null;
  let humanGateRequired = true;

  if (task === "voice") {
    route = routeIrisVoice(env);
    tool = authorizeTool({ tool: "provider_status", allowedTools: [...defaultToolsForAgent(), "provider_status"] });
    humanGateRequired = false;
    notes.push(route.provider === "elevenlabs"
      ? "TTS enrutado a ElevenLabs solo si la clave está configurada."
      : "TTS enrutado a speechSynthesis (fallback local).");
  } else if (task === "edit" || task === "ask") {
    route = routeIrisTextRequest({ question: input.question, env });
    tool = authorizeTool({
      tool: task === "edit" ? "draft_composer" : "business_context",
      allowedTools: defaultToolsForAgent(),
      agentStatus: input.agentStatus,
      humanApproved: input.humanApproved,
    });
    humanGateRequired = route.kind === "edit" ? false : false;
    notes.push(`Proveedor de texto: ${route.provider} (${route.reason}).`);
  } else if (task === "mission") {
    tool = authorizeTool({
      tool: "mission_plan",
      allowedTools: [...defaultToolsForAgent(), "mission_plan"],
      humanApproved: input.humanApproved,
    });
    notes.push("Las misiones planifican y sandboxeán; verificación humana obligatoria.");
  } else if (task === "creator") {
    tool = authorizeTool({
      tool: "policy_sandbox",
      allowedTools: defaultToolsForAgent(),
      humanApproved: input.humanApproved,
    });
    notes.push("Creator diseña + Guardian; activación solo con aprobación humana.");
  } else {
    tool = authorizeTool({
      tool: "provider_status",
      allowedTools: [...defaultToolsForAgent(), "provider_status"],
    });
    humanGateRequired = false;
    notes.push("Probe de proveedores: nunca inventa live_ok sin HTTP real.");
  }

  return {
    task,
    route,
    tool,
    isolation: {
      level: "worker_request_isolate+policy_sandbox",
      claimsContainerOrVm: false,
      claimsOsShell: false,
    },
    humanGateRequired,
    notes,
  };
}

export function buildCoordinatorSnapshot(input: {
  env?: Record<string, string | undefined>;
  creator: CreatorDeskState;
  missions: MissionDesk;
  queue: JobQueueState;
  now?: string;
}): CoordinatorSnapshot {
  const env = input.env || {};
  const agents = input.creator.agents;
  const missions = input.missions.missions;
  return {
    generatedAt: input.now || new Date().toISOString(),
    providers: listProviderStatus(env),
    voice: routeIrisVoice(env),
    agents: {
      total: agents.length,
      approved: agents.filter(item => item.status === "approved").length,
      paused: agents.filter(item => item.status === "paused").length,
      awaitingApproval: agents.filter(item => item.status === "awaiting_approval").length,
      cancelled: agents.filter(item => (item.status as string) === "cancelled").length,
    },
    missions: {
      total: missions.length,
      awaitingApproval: missions.filter(item => ["executed", "awaiting_approval", "verified"].includes(item.status)).length,
      verified: missions.filter(item => item.status === "verified").length,
      failed: missions.filter(item => item.status === "failed").length,
      cancelled: missions.filter(item => item.status === "cancelled").length,
    },
    queue: queueStats(input.queue),
    isolationClaim: "worker_request_isolate+policy_sandbox (no container/VM)",
  };
}
