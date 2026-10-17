/** SaaS plan catalog and limit checks. No payment provider wired. */

export const IRIS_PLANS = ["starter", "business", "enterprise"] as const;
export type IrisPlanId = (typeof IRIS_PLANS)[number];

export type PlanLimits = {
  id: IrisPlanId;
  label: string;
  maxAgents: number;
  maxMissionsPerMonth: number;
  maxRequestsPerMonth: number;
  maxTokensPerMonth: number;
  defaultBudgetCents: number;
  priceUsdMonthly: number | null; // informational only until billing authorized
};

export const PLAN_LIMITS: Record<IrisPlanId, PlanLimits> = {
  starter: {
    id: "starter",
    label: "Starter",
    maxAgents: 3,
    maxMissionsPerMonth: 50,
    maxRequestsPerMonth: 5_000,
    maxTokensPerMonth: 200_000,
    defaultBudgetCents: 2_500,
    priceUsdMonthly: 49,
  },
  business: {
    id: "business",
    label: "Business",
    maxAgents: 25,
    maxMissionsPerMonth: 500,
    maxRequestsPerMonth: 50_000,
    maxTokensPerMonth: 2_000_000,
    defaultBudgetCents: 25_000,
    priceUsdMonthly: 249,
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    maxAgents: 200,
    maxMissionsPerMonth: 5_000,
    maxRequestsPerMonth: 500_000,
    maxTokensPerMonth: 20_000_000,
    defaultBudgetCents: 250_000,
    priceUsdMonthly: null,
  },
};

export type UsageSnapshot = {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  missions: number;
  agentRuns: number;
  estimatedCostCents: number;
  agentCount?: number;
};

export type LimitDecision = {
  allowed: boolean;
  code: "ok" | "ORG_SUSPENDED" | "AGENT_LIMIT" | "MISSION_LIMIT" | "REQUEST_LIMIT" | "TOKEN_LIMIT" | "BUDGET_EXCEEDED";
  detail: string;
};

export function currentUsagePeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function evaluatePlanLimits(input: {
  plan: IrisPlanId;
  orgStatus: "ACTIVE" | "SUSPENDED";
  budgetCentsMonthly: number;
  usage: UsageSnapshot;
  action: "read" | "mission" | "agent_create" | "agent_run" | "request";
}): LimitDecision {
  if (input.orgStatus !== "ACTIVE") {
    return { allowed: false, code: "ORG_SUSPENDED", detail: "Organization is suspended." };
  }
  if (input.action === "read") return { allowed: true, code: "ok", detail: "read_ok" };

  const limits = PLAN_LIMITS[input.plan] || PLAN_LIMITS.starter;
  const tokens = input.usage.tokensIn + input.usage.tokensOut;

  if (input.usage.estimatedCostCents >= input.budgetCentsMonthly) {
    return { allowed: false, code: "BUDGET_EXCEEDED", detail: "Monthly budget exhausted." };
  }
  if (input.usage.requests >= limits.maxRequestsPerMonth) {
    return { allowed: false, code: "REQUEST_LIMIT", detail: "Monthly request limit reached." };
  }
  if (tokens >= limits.maxTokensPerMonth) {
    return { allowed: false, code: "TOKEN_LIMIT", detail: "Monthly token limit reached." };
  }
  if (input.action === "mission" && input.usage.missions >= limits.maxMissionsPerMonth) {
    return { allowed: false, code: "MISSION_LIMIT", detail: "Monthly mission limit reached." };
  }
  if (input.action === "agent_create" && (input.usage.agentCount || 0) >= limits.maxAgents) {
    return { allowed: false, code: "AGENT_LIMIT", detail: "Agent seat limit reached for this plan." };
  }
  return { allowed: true, code: "ok", detail: "within_limits" };
}

/** Stub billing provider — real charging requires owner authorization. */
export type BillingProvider = {
  id: "none" | "stripe";
  chargeEnabled: false;
  note: string;
};

export function getBillingProvider(): BillingProvider {
  return {
    id: "none",
    chargeEnabled: false,
    note: "Payment integration disabled until explicitly authorized. Plans enforce soft limits only.",
  };
}
