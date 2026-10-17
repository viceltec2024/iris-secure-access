export const CREATED_AGENT_STATUSES = [
  "draft",
  "sandbox_passed",
  "sandbox_failed",
  "awaiting_approval",
  "approved",
  "rejected",
  "paused",
  "cancelled",
] as const;

export type CreatedAgentStatus = (typeof CREATED_AGENT_STATUSES)[number];

export const AGENT_PERMISSIONS = [
  "read_business_context",
  "draft_replies",
  "propose_actions",
  "propose_code_changes",
  "propose_tests",
  "notify_owner",
  "run_on_schedule",
] as const;

export type AgentPermission = (typeof AGENT_PERMISSIONS)[number];

export const AGENT_SCHEDULES = ["always_on", "business_hours", "on_demand"] as const;
export type AgentSchedule = (typeof AGENT_SCHEDULES)[number];

export type GuardianFinding = {
  severity: "info" | "warn" | "block";
  code: string;
  message: string;
};

export type SandboxCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type AgentBlueprint = {
  role: string;
  specialty: string;
  goals: string[];
  tools: string[];
  constraints: string[];
};

export const PROPOSAL_TYPES = ["code_improvement", "test_plan", "action"] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];
export const PROPOSAL_STATUSES = ["awaiting_approval", "approved", "rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type AgentProposal = {
  id: string;
  type: ProposalType;
  title: string;
  body: string;
  status: ProposalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type CreatedAgent = {
  id: string;
  name: string;
  prompt: string;
  status: CreatedAgentStatus;
  permissions: AgentPermission[];
  schedule: AgentSchedule;
  autonomy: "supervised";
  blueprint: AgentBlueprint;
  sourcePreview: string;
  sandbox: {
    ranAt: string | null;
    passed: boolean;
    checks: SandboxCheck[];
  };
  guardian: {
    requiresHumanApproval: true;
    blockedCapabilities: string[];
    findings: GuardianFinding[];
  };
  proposals: AgentProposal[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  lastTickAt?: string;
};

export type CreatorDeskState = {
  agents: CreatedAgent[];
};

export const BLOCKED_CAPABILITIES = [
  "exec_shell",
  "spend_money",
  "self_modify_core",
  "deploy_without_approval",
  "exfiltrate_secrets",
  "network_unrestricted",
] as const;

const MAX_AGENTS = 24;
const MAX_PROMPT = 500;

export function emptyCreatorDesk(): CreatorDeskState {
  return { agents: [] };
}

export function parseCreatorDesk(value: string): CreatorDeskState {
  try {
    const parsed = JSON.parse(value) as Partial<CreatorDeskState>;
    return {
      agents: Array.isArray(parsed.agents)
        ? parsed.agents.filter(isStoredAgent).map(normalizeStoredAgent)
        : [],
    };
  } catch {
    return emptyCreatorDesk();
  }
}

function isStoredAgent(value: unknown): value is CreatedAgent {
  if (!value || typeof value !== "object") return false;
  const agent = value as CreatedAgent;
  return Boolean(
    agent.id
    && typeof agent.name === "string"
    && typeof agent.prompt === "string"
    && CREATED_AGENT_STATUSES.includes(agent.status)
    && agent.autonomy === "supervised"
    && agent.guardian?.requiresHumanApproval === true
  );
}

function normalizeStoredAgent(agent: CreatedAgent): CreatedAgent {
  return {
    ...agent,
    proposals: Array.isArray(agent.proposals) ? agent.proposals.filter(isStoredProposal) : [],
  };
}

function isStoredProposal(value: unknown): value is AgentProposal {
  if (!value || typeof value !== "object") return false;
  const proposal = value as AgentProposal;
  return Boolean(
    proposal.id
    && typeof proposal.title === "string"
    && typeof proposal.body === "string"
    && PROPOSAL_TYPES.includes(proposal.type)
    && PROPOSAL_STATUSES.includes(proposal.status)
  );
}

export function normalizeCreatorPrompt(value: unknown) {
  const prompt = String(value || "").trim().replace(/\s+/g, " ");
  if (prompt.length < 8 || prompt.length > MAX_PROMPT) return null;
  return prompt;
}

export function extractSpecialty(prompt: string, language: "es" | "en" = "es") {
  const cleaned = prompt
    .replace(/^(?:oye|hey|ok|okay|hola|escucha)\s+iris[,:]?\s+/i, "")
    .replace(/^iris[,:]?\s+/i, "")
    .trim();

  const storeMatch = cleaned.match(/(?:tienda|store|negocio|business|shop)\s+([^.!?,]{3,80})/i);
  if (storeMatch?.[1]) return titleCase(storeMatch[1].trim());

  const specialized = cleaned.match(/(?:especializada? en|specialized in|para)\s+([^.!?,]{3,80})/i);
  if (specialized?.[1]) return titleCase(specialized[1].trim());

  const createMatch = cleaned.match(/(?:crea(?:r)?|create|genera(?:r)?|build)\s+(?:una?\s+)?(?:inteligencia artificial|ia|ai|agente)(?:\s+especializada?)?\s*(?:en|para|for)?\s*([^.!?,]{0,80})/i);
  if (createMatch?.[1]?.trim()) return titleCase(createMatch[1].trim());

  return language === "es" ? "Agente personalizado" : "Custom agent";
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 72);
}

export function slugifyAgentId(specialty: string, id: string) {
  const slug = specialty
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "agent";
  return `${slug}-${id.slice(0, 8)}`;
}

export function designAgentFromPrompt(input: {
  id: string;
  prompt: string;
  language?: "es" | "en";
  schedule?: AgentSchedule;
  now?: string;
}): CreatedAgent {
  const language = input.language || "es";
  const prompt = normalizeCreatorPrompt(input.prompt);
  if (!prompt) throw new Error(language === "es" ? "Describe el agente en al menos 8 caracteres." : "Describe the agent in at least 8 characters.");

  const specialty = extractSpecialty(prompt, language);
  const now = input.now || new Date().toISOString();
  const schedule = input.schedule && AGENT_SCHEDULES.includes(input.schedule) ? input.schedule : "always_on";
  const name = language === "es" ? `IRIS · ${specialty}` : `IRIS · ${specialty}`;

  const blueprint: AgentBlueprint = {
    role: language === "es" ? `Agente especializado · ${specialty}` : `Specialized agent · ${specialty}`,
    specialty,
    goals: language === "es"
      ? [
        `Administrar tareas rutinarias de ${specialty}`,
        "Proponer acciones claras al operador humano",
        "Mantener un registro auditable de cada propuesta",
      ]
      : [
        `Handle routine work for ${specialty}`,
        "Propose clear actions to the human operator",
        "Keep an auditable record of every proposal",
      ],
    tools: ["business_context", "draft_composer", "owner_notifier", "proposal_queue"],
    constraints: language === "es"
      ? [
        "No gasta dinero ni firma pagos",
        "No ejecuta shell ni cambia el núcleo de IRIS",
        "No despliega cambios sin aprobación humana",
        "Solo actúa dentro de permisos preaprobados",
      ]
      : [
        "Does not spend money or sign payments",
        "Does not run shell or change IRIS core",
        "Does not deploy changes without human approval",
        "Only acts within pre-approved permissions",
      ],
  };

  const permissions: AgentPermission[] = [
    "read_business_context",
    "draft_replies",
    "propose_actions",
    "propose_code_changes",
    "propose_tests",
    "notify_owner",
    schedule === "on_demand" ? "notify_owner" : "run_on_schedule",
  ].filter((value, index, all): value is AgentPermission => AGENT_PERMISSIONS.includes(value as AgentPermission) && all.indexOf(value) === index);

  const agent: CreatedAgent = {
    id: input.id,
    name,
    prompt,
    status: "draft",
    permissions,
    schedule,
    autonomy: "supervised",
    blueprint,
    sourcePreview: "",
    sandbox: { ranAt: null, passed: false, checks: [] },
    guardian: {
      requiresHumanApproval: true,
      blockedCapabilities: [...BLOCKED_CAPABILITIES],
      findings: [],
    },
    proposals: [],
    createdAt: now,
    updatedAt: now,
  };

  return runCreatorPipeline(agent, language, now);
}

export function generateAgentSource(agent: CreatedAgent) {
  const specialty = JSON.stringify(agent.blueprint.specialty);
  const goals = JSON.stringify(agent.blueprint.goals, null, 2);
  const permissions = JSON.stringify(agent.permissions, null, 2);
  return `/** IRIS Creator sandbox agent — supervised only */
export const agentSpec = {
  id: ${JSON.stringify(agent.id)},
  name: ${JSON.stringify(agent.name)},
  specialty: ${specialty},
  schedule: ${JSON.stringify(agent.schedule)},
  autonomy: "supervised",
  permissions: ${permissions},
  goals: ${goals},
  blocked: ${JSON.stringify([...BLOCKED_CAPABILITIES])},
};

export function proposeAction(input) {
  if (!agentSpec.permissions.includes("propose_actions")) {
    throw new Error("permission_denied");
  }
  return {
    type: "proposal",
    requiresHumanApproval: true,
    summary: String(input?.summary || "").slice(0, 280),
    createdAt: new Date().toISOString(),
  };
}

export function proposeImprovement(input) {
  const type = input?.type === "test_plan" ? "test_plan" : "code_improvement";
  const permission = type === "test_plan" ? "propose_tests" : "propose_code_changes";
  if (!agentSpec.permissions.includes(permission)) {
    throw new Error("permission_denied");
  }
  return {
    type: "proposal",
    proposalType: type,
    requiresHumanApproval: true,
    applied: false,
    summary: String(input?.summary || "").slice(0, 280),
    body: String(input?.body || "").slice(0, 4000),
    createdAt: new Date().toISOString(),
  };
}

export function tick() {
  if (!agentSpec.permissions.includes("run_on_schedule") && agentSpec.schedule === "always_on") {
    return { ok: false, reason: "schedule_not_allowed" };
  }
  return { ok: true, status: "heartbeat", autonomy: "supervised" };
}
`;
}

export function runGuardianChecks(agent: CreatedAgent, language: "es" | "en" = "es"): GuardianFinding[] {
  const findings: GuardianFinding[] = [];
  const source = agent.sourcePreview || generateAgentSource(agent);

  findings.push({
    severity: "info",
    code: "HUMAN_GATE",
    message: language === "es"
      ? "Guardian exige aprobación humana antes de activar el agente."
      : "Guardian requires human approval before activating the agent.",
  });

  for (const capability of BLOCKED_CAPABILITIES) {
    if (new RegExp(capability.replaceAll("_", "[_\\s-]*"), "i").test(agent.prompt) && /permit|allow|habilita|permite|sin aprob/i.test(agent.prompt)) {
      findings.push({
        severity: "block",
        code: `BLOCK_${capability.toUpperCase()}`,
        message: language === "es"
          ? `El prompt pide la capacidad bloqueada: ${capability}.`
          : `The prompt requests a blocked capability: ${capability}.`,
      });
    }
  }

  if (/\b(rm\s+-rf|eval\(|Function\(|child_process|process\.env|API_KEY|secret|password)\b/i.test(source) || /\b(rm\s+-rf|eval\(|child_process)\b/i.test(agent.prompt)) {
    findings.push({
      severity: "block",
      code: "UNSAFE_CODE_PATTERN",
      message: language === "es"
        ? "Guardian bloqueó patrones inseguros en el código o el prompt."
        : "Guardian blocked unsafe patterns in the code or prompt.",
    });
  }

  if (agent.autonomy !== "supervised") {
    findings.push({
      severity: "block",
      code: "AUTONOMY_LIMIT",
      message: language === "es"
        ? "Solo se permiten agentes supervisados en este MVP."
        : "Only supervised agents are allowed in this MVP.",
    });
  }

  if (!agent.guardian.requiresHumanApproval) {
    findings.push({
      severity: "block",
      code: "MISSING_APPROVAL_GATE",
      message: language === "es"
        ? "Falta la puerta de aprobación humana."
        : "The human approval gate is missing.",
    });
  }

  if (!findings.some(item => item.severity === "block")) {
    findings.push({
      severity: "info",
      code: "SANDBOX_ONLY",
      message: language === "es"
        ? "El agente solo puede proponer; no despliega ni gasta sin tu OK."
        : "The agent may only propose; it cannot deploy or spend without your OK.",
    });
  }

  return findings;
}

export function runSandbox(agent: CreatedAgent, language: "es" | "en" = "es", now = new Date().toISOString()) {
  const sourcePreview = generateAgentSource(agent);
  const withSource = { ...agent, sourcePreview };
  const findings = runGuardianChecks(withSource, language);
  const blocked = findings.some(item => item.severity === "block");

  const checks: SandboxCheck[] = [
    {
      id: "spec_valid",
      label: language === "es" ? "Especificación válida" : "Valid specification",
      ok: Boolean(agent.blueprint.specialty && agent.blueprint.goals.length >= 2),
      detail: language === "es" ? "Rol, metas y herramientas definidos." : "Role, goals, and tools defined.",
    },
    {
      id: "permissions_least",
      label: language === "es" ? "Permisos mínimos" : "Least privilege",
      ok: agent.permissions.every(permission => AGENT_PERMISSIONS.includes(permission)),
      detail: language === "es" ? "Sin capacidades peligrosas concedidas." : "No dangerous capabilities granted.",
    },
    {
      id: "guardian_gate",
      label: language === "es" ? "Puerta Guardian" : "Guardian gate",
      ok: !blocked && agent.guardian.requiresHumanApproval,
      detail: blocked
        ? (language === "es" ? "Guardian encontró bloqueos." : "Guardian found blocking issues.")
        : (language === "es" ? "Aprobación humana obligatoria." : "Human approval required."),
    },
    {
      id: "tick_supervised",
      label: language === "es" ? "Latido supervisado" : "Supervised heartbeat",
      ok: !blocked,
      detail: language === "es"
        ? "tick() solo reporta estado; no aplica cambios."
        : "tick() only reports status; it does not apply changes.",
    },
  ];

  const passed = checks.every(check => check.ok) && !blocked;
  return {
    ...withSource,
    status: (passed ? "sandbox_passed" : "sandbox_failed") as CreatedAgentStatus,
    sandbox: { ranAt: now, passed, checks },
    guardian: {
      ...withSource.guardian,
      findings,
    },
    updatedAt: now,
  };
}

export function runCreatorPipeline(agent: CreatedAgent, language: "es" | "en" = "es", now = new Date().toISOString()) {
  const sandboxed = runSandbox(agent, language, now);
  if (!sandboxed.sandbox.passed) return sandboxed;
  return {
    ...sandboxed,
    status: "awaiting_approval" as const,
    updatedAt: now,
  };
}

export function addCreatedAgent(state: CreatorDeskState, agent: CreatedAgent): CreatorDeskState {
  const agents = [agent, ...state.agents].slice(0, MAX_AGENTS);
  return { agents };
}

export function approveCreatedAgent(state: CreatorDeskState, agentId: string, actorEmail: string, now = new Date().toISOString()) {
  const agent = state.agents.find(item => item.id === agentId);
  if (!agent) throw new Error("Agent not found");
  if (agent.status !== "awaiting_approval" && agent.status !== "paused") {
    throw new Error("Agent is not awaiting approval");
  }
  if (!agent.sandbox.passed) throw new Error("Sandbox did not pass");
  if (agent.guardian.findings.some(item => item.severity === "block")) throw new Error("Guardian blocked deployment");

  const next: CreatedAgent = {
    ...agent,
    status: "approved",
    approvedAt: now,
    approvedBy: actorEmail,
    updatedAt: now,
    lastTickAt: now,
  };
  return {
    state: { agents: state.agents.map(item => item.id === agentId ? next : item) },
    agent: next,
  };
}

export function rejectCreatedAgent(state: CreatorDeskState, agentId: string, now = new Date().toISOString()) {
  const agent = state.agents.find(item => item.id === agentId);
  if (!agent) throw new Error("Agent not found");
  if (agent.status !== "awaiting_approval") throw new Error("Agent is not awaiting approval");
  const next: CreatedAgent = {
    ...agent,
    status: "rejected",
    rejectedAt: now,
    updatedAt: now,
  };
  return {
    state: { agents: state.agents.map(item => item.id === agentId ? next : item) },
    agent: next,
  };
}

export function pauseCreatedAgent(state: CreatorDeskState, agentId: string, now = new Date().toISOString()) {
  const agent = state.agents.find(item => item.id === agentId);
  if (!agent) throw new Error("Agent not found");
  if (agent.status !== "approved") throw new Error("Only approved agents can be paused");
  const next: CreatedAgent = {
    ...agent,
    status: "paused",
    updatedAt: now,
  };
  return {
    state: { agents: state.agents.map(item => item.id === agentId ? next : item) },
    agent: next,
  };
}

export function cancelCreatedAgent(state: CreatorDeskState, agentId: string, now = new Date().toISOString()) {
  const agent = state.agents.find(item => item.id === agentId);
  if (!agent) throw new Error("Agent not found");
  if (["rejected", "cancelled"].includes(agent.status)) {
    throw new Error("Agent already stopped");
  }
  const next: CreatedAgent = {
    ...agent,
    status: "cancelled",
    updatedAt: now,
  };
  return {
    state: { agents: state.agents.map(item => item.id === agentId ? next : item) },
    agent: next,
  };
}

export function tickApprovedAgents(state: CreatorDeskState, now = new Date().toISOString()): CreatorDeskState {
  return {
    agents: state.agents.map(agent => {
      if (agent.status !== "approved") return agent;
      if (agent.schedule === "on_demand") return agent;
      return { ...agent, lastTickAt: now, updatedAt: now };
    }),
  };
}

export function buildImprovementProposal(input: {
  id: string;
  agent: CreatedAgent;
  type?: ProposalType;
  language?: "es" | "en";
  now?: string;
}): AgentProposal {
  const language = input.language || "es";
  const type: ProposalType = input.type === "test_plan" ? "test_plan" : "code_improvement";
  const specialty = input.agent.blueprint.specialty;
  const now = input.now || new Date().toISOString();
  if (type === "test_plan") {
    return {
      id: input.id,
      type,
      title: language === "es" ? `Plan de pruebas · ${specialty}` : `Test plan · ${specialty}`,
      body: language === "es"
        ? [
          `# Plan de pruebas propuesto (no ejecutado)`,
          `1. unit: designAgentFromPrompt + sandbox Guardian para “${specialty}”`,
          `2. api: POST /api/iris-creator create → awaiting_approval`,
          `3. security: rechazar prompts con exec_shell / spend_money`,
          `4. voice: GET /api/iris-voice solo si ElevenLabs está listo`,
          ``,
          `Estado: awaiting_approval. IRIS no aplica ni corre CI sin tu OK.`,
        ].join("\n")
        : [
          `# Proposed test plan (not executed)`,
          `1. unit: designAgentFromPrompt + Guardian sandbox for “${specialty}”`,
          `2. api: POST /api/iris-creator create → awaiting_approval`,
          `3. security: reject prompts with exec_shell / spend_money`,
          `4. voice: GET /api/iris-voice only when ElevenLabs is ready`,
          ``,
          `Status: awaiting_approval. IRIS will not apply or run CI without your OK.`,
        ].join("\n"),
      status: "awaiting_approval",
      createdAt: now,
    };
  }
  return {
    id: input.id,
    type,
    title: language === "es" ? `Mejora de código · ${specialty}` : `Code improvement · ${specialty}`,
    body: language === "es"
      ? [
        `# Propuesta de mejora (no aplicada al repo)`,
        `- Ampliar metas del agente “${specialty}” con checklist auditable`,
        `- Mantener autonomy: supervised y requiresHumanApproval: true`,
        `- Añadir prueba que bloquee deploy_without_approval`,
        ``,
        `IRIS solo propone. Aprobar aquí no hace git push ni deploy.`,
      ].join("\n")
      : [
        `# Improvement proposal (not applied to the repo)`,
        `- Expand “${specialty}” agent goals with an auditable checklist`,
        `- Keep autonomy: supervised and requiresHumanApproval: true`,
        `- Add a test that blocks deploy_without_approval`,
        ``,
        `IRIS only proposes. Approving here does not git push or deploy.`,
      ].join("\n"),
    status: "awaiting_approval",
    createdAt: now,
  };
}

export function addAgentProposal(state: CreatorDeskState, agentId: string, proposal: AgentProposal) {
  const agent = state.agents.find(item => item.id === agentId);
  if (!agent) throw new Error("Agent not found");
  if (agent.status !== "approved" && agent.status !== "awaiting_approval") {
    throw new Error("Agent cannot propose until designed");
  }
  if (proposal.type === "code_improvement" && !agent.permissions.includes("propose_code_changes")) {
    throw new Error("permission_denied");
  }
  if (proposal.type === "test_plan" && !agent.permissions.includes("propose_tests")) {
    throw new Error("permission_denied");
  }
  const next: CreatedAgent = {
    ...agent,
    proposals: [proposal, ...(agent.proposals || [])].slice(0, 40),
    updatedAt: proposal.createdAt,
  };
  return {
    state: { agents: state.agents.map(item => item.id === agentId ? next : item) },
    agent: next,
    proposal,
  };
}

export function decideAgentProposal(
  state: CreatorDeskState,
  agentId: string,
  proposalId: string,
  decision: "approve" | "reject",
  actorEmail: string,
  now = new Date().toISOString(),
) {
  const agent = state.agents.find(item => item.id === agentId);
  if (!agent) throw new Error("Agent not found");
  const proposal = (agent.proposals || []).find(item => item.id === proposalId);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "awaiting_approval") throw new Error("Proposal is not awaiting approval");
  const nextProposal: AgentProposal = {
    ...proposal,
    status: decision === "approve" ? "approved" : "rejected",
    decidedAt: now,
    decidedBy: actorEmail,
  };
  const next: CreatedAgent = {
    ...agent,
    proposals: agent.proposals.map(item => item.id === proposalId ? nextProposal : item),
    updatedAt: now,
  };
  return {
    state: { agents: state.agents.map(item => item.id === agentId ? next : item) },
    agent: next,
    proposal: nextProposal,
  };
}

export function isCreatorRequest(question: string) {
  const text = question.toLocaleLowerCase();
  return /\b(crea(?:r)?|create|genera(?:r)?|build)\b/.test(text)
    && /\b(agente|agent|inteligencia artificial|\bia\b|\bai\b)\b/.test(text);
}

export function creatorAskReply(language: "es" | "en", userName: string, specialtyHint = "") {
  const name = userName.split(/[\s@]/)[0] || "operador";
  const specialty = specialtyHint || (language === "es" ? "tu negocio" : "your business");
  return language === "es"
    ? `${name}, abre IRIS Creator en el menú. Describe el agente (por ejemplo “administrar ${specialty}”), Guardian lo prueba en sandbox y yo te pido aprobación antes de dejarlo activo 24/7 con acciones preaprobadas.`
    : `${name}, open IRIS Creator in the menu. Describe the agent (for example “manage ${specialty}”), Guardian tests it in a sandbox, and I ask for your approval before it stays active 24/7 with pre-approved actions.`;
}
