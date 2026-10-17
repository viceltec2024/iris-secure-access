/**
 * Usage metering and budget enforcement per organization.
 * Payment collection is intentionally not implemented.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { organizationUsageMonthly, usageEvents } from "../db/schema";
import {
  currentUsagePeriod,
  evaluatePlanLimits,
  getBillingProvider,
  type BillingProvider,
  type IrisPlanId,
  type LimitDecision,
  type UsageSnapshot,
} from "./iris-plans.ts";

export { getBillingProvider, type BillingProvider };

export type MeterKind = "request" | "mission" | "agent_run" | "agent_create" | "tokens";

export async function getMonthlyUsage(organizationId: string, period = currentUsagePeriod()): Promise<UsageSnapshot> {
  const [row] = await getDb()
    .select()
    .from(organizationUsageMonthly)
    .where(and(
      eq(organizationUsageMonthly.organizationId, organizationId),
      eq(organizationUsageMonthly.period, period),
    ))
    .limit(1);
  if (!row) {
    return { requests: 0, tokensIn: 0, tokensOut: 0, missions: 0, agentRuns: 0, estimatedCostCents: 0 };
  }
  return {
    requests: row.requests,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    missions: row.missions,
    agentRuns: row.agentRuns,
    estimatedCostCents: row.estimatedCostCents,
  };
}

export async function recordUsageEvent(input: {
  organizationId: string;
  actorEmail: string;
  kind: MeterKind;
  quantity?: number;
  tokensIn?: number;
  tokensOut?: number;
  estimatedCostCents?: number;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const period = currentUsagePeriod();
  const now = new Date().toISOString();
  const quantity = Math.max(1, input.quantity || 1);
  const tokensIn = Math.max(0, input.tokensIn || 0);
  const tokensOut = Math.max(0, input.tokensOut || 0);
  const estimatedCostCents = Math.max(0, input.estimatedCostCents || 0);

  await db.insert(usageEvents).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    actorEmail: input.actorEmail.trim().toLowerCase(),
    kind: input.kind,
    quantity,
    tokensIn,
    tokensOut,
    estimatedCostCents,
    metadata: JSON.stringify(input.metadata || {}),
    createdAt: now,
  });

  const [existing] = await db
    .select()
    .from(organizationUsageMonthly)
    .where(and(
      eq(organizationUsageMonthly.organizationId, input.organizationId),
      eq(organizationUsageMonthly.period, period),
    ))
    .limit(1);

  const requestInc = input.kind === "request" || input.kind === "mission" || input.kind === "agent_run" ? quantity : 0;
  const missionInc = input.kind === "mission" ? quantity : 0;
  const agentRunInc = input.kind === "agent_run" || input.kind === "agent_create" ? quantity : 0;

  if (!existing) {
    await db.insert(organizationUsageMonthly).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      period,
      requests: requestInc,
      tokensIn,
      tokensOut,
      missions: missionInc,
      agentRuns: agentRunInc,
      estimatedCostCents,
      updatedAt: now,
    });
    return;
  }

  await db.update(organizationUsageMonthly).set({
    requests: existing.requests + requestInc,
    tokensIn: existing.tokensIn + tokensIn,
    tokensOut: existing.tokensOut + tokensOut,
    missions: existing.missions + missionInc,
    agentRuns: existing.agentRuns + agentRunInc,
    estimatedCostCents: existing.estimatedCostCents + estimatedCostCents,
    updatedAt: now,
  }).where(eq(organizationUsageMonthly.id, existing.id));
}

export async function assertOrgWithinLimits(input: {
  organizationId: string;
  plan: IrisPlanId;
  orgStatus: "ACTIVE" | "SUSPENDED";
  budgetCentsMonthly: number;
  action: "read" | "mission" | "agent_create" | "agent_run" | "request";
  agentCount?: number;
}): Promise<LimitDecision> {
  const usage = await getMonthlyUsage(input.organizationId);
  return evaluatePlanLimits({
    plan: input.plan,
    orgStatus: input.orgStatus,
    budgetCentsMonthly: input.budgetCentsMonthly,
    usage: { ...usage, agentCount: input.agentCount },
    action: input.action,
  });
}

