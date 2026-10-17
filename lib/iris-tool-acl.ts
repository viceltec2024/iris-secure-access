/**
 * Tool access control for IRIS agents and missions.
 * Sensitive tools always require a human approval token recorded in audit.
 * Never grants exec_shell, network_unrestricted, or core mutation.
 */

export const IRIS_TOOLS = [
  "business_context",
  "draft_composer",
  "owner_notifier",
  "proposal_queue",
  "mission_plan",
  "policy_sandbox",
  "memory_read",
  "memory_append",
  "provider_status",
] as const;

export type IrisToolId = (typeof IRIS_TOOLS)[number];

export const FORBIDDEN_TOOLS = [
  "exec_shell",
  "filesystem_write",
  "git_push",
  "deploy_production",
  "spend_money",
  "self_modify_core",
  "exfiltrate_secrets",
  "network_unrestricted",
] as const;

export type ToolAclDecision = {
  allowed: boolean;
  tool: string;
  reason: string;
  requiresHumanApproval: boolean;
};

const DEFAULT_AGENT_TOOLS: IrisToolId[] = [
  "business_context",
  "draft_composer",
  "owner_notifier",
  "proposal_queue",
  "policy_sandbox",
  "memory_read",
];

const SENSITIVE_TOOLS = new Set<IrisToolId>([
  "memory_append",
  "proposal_queue",
  "owner_notifier",
]);

export function defaultToolsForAgent(): IrisToolId[] {
  return [...DEFAULT_AGENT_TOOLS];
}

export function isForbiddenTool(tool: string) {
  return (FORBIDDEN_TOOLS as readonly string[]).includes(tool)
    || /exec_shell|child_process|eval|self_modify|deploy_without|exfiltrate/i.test(tool);
}

export function authorizeTool(input: {
  tool: string;
  allowedTools?: readonly string[];
  agentStatus?: string;
  humanApproved?: boolean;
}): ToolAclDecision {
  const tool = String(input.tool || "").trim();
  if (!tool) {
    return { allowed: false, tool, reason: "empty_tool", requiresHumanApproval: true };
  }
  if (isForbiddenTool(tool)) {
    return { allowed: false, tool, reason: "forbidden_tool", requiresHumanApproval: true };
  }
  if (!(IRIS_TOOLS as readonly string[]).includes(tool)) {
    return { allowed: false, tool, reason: "unknown_tool", requiresHumanApproval: true };
  }
  const allowlist = input.allowedTools || DEFAULT_AGENT_TOOLS;
  if (!allowlist.includes(tool)) {
    return { allowed: false, tool, reason: "not_in_agent_allowlist", requiresHumanApproval: true };
  }
  if (input.agentStatus && !["approved", "awaiting_approval", "sandbox_passed"].includes(input.agentStatus)) {
    if (tool !== "policy_sandbox" && tool !== "business_context" && tool !== "mission_plan") {
      return { allowed: false, tool, reason: "agent_not_active", requiresHumanApproval: true };
    }
  }
  const sensitive = SENSITIVE_TOOLS.has(tool as IrisToolId);
  if (sensitive && input.humanApproved === false) {
    return { allowed: false, tool, reason: "human_approval_required", requiresHumanApproval: true };
  }
  return {
    allowed: true,
    tool,
    reason: sensitive ? "allowed_sensitive" : "allowed",
    requiresHumanApproval: sensitive,
  };
}
