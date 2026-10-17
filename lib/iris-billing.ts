/**
 * Billing integration — test mode only.
 * Real charging stays disabled until explicit owner authorization.
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { organizationBillingEvents, organizations } from "../db/schema";
import { logAudit } from "./authz.ts";
import { getBillingProvider, type BillingProvider } from "./iris-billing-core.ts";
import { PLAN_LIMITS, type IrisPlanId } from "./iris-plans.ts";
import { canAdminOrg, type OrgRole } from "./iris-tenant-core.ts";

export type { BillingMode, BillingProvider } from "./iris-billing-core.ts";
export { getBillingProvider } from "./iris-billing-core.ts";

type EnvLike = Record<string, string | undefined>;

export async function listBillingEvents(organizationId: string, limit = 20) {
  return getDb()
    .select()
    .from(organizationBillingEvents)
    .where(eq(organizationBillingEvents.organizationId, organizationId))
    .orderBy(desc(organizationBillingEvents.createdAt))
    .limit(Math.min(limit, 50));
}

export async function startTestCheckout(input: {
  organizationId: string;
  actorEmail: string;
  actorRole: OrgRole;
  plan: IrisPlanId;
  env?: EnvLike;
}) {
  if (!canAdminOrg(input.actorRole)) throw new Error("Administrator access required");
  const billing = getBillingProvider(input.env || {});
  if (billing.mode === "blocked_live") {
    throw new Error("Live billing is blocked");
  }
  if (!billing.testMode) {
    throw new Error("Enable IRIS_BILLING_TEST=1 for test checkout");
  }
  if (!PLAN_LIMITS[input.plan]) throw new Error("Unknown plan");

  const amountCents = (PLAN_LIMITS[input.plan].priceUsdMonthly || 0) * 100;
  const providerRef = `test_cs_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const customerTestId = `cus_test_${input.organizationId.slice(0, 8)}`;

  await getDb().insert(organizationBillingEvents).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    actorEmail: input.actorEmail.trim().toLowerCase(),
    kind: "test_checkout_started",
    plan: input.plan,
    amountCents,
    mode: "test",
    providerRef,
    metadata: JSON.stringify({ chargeEnabled: false, simulated: true }),
    createdAt: now,
  });

  await getDb().update(organizations).set({
    billingMode: "test",
    stripeCustomerTestId: customerTestId,
    updatedAt: now,
  }).where(eq(organizations.id, input.organizationId));

  await logAudit(input.actorEmail, "BILLING_TEST_CHECKOUT", input.organizationId, "SUCCESS", {
    plan: input.plan,
    providerRef,
    amountCents,
  }, input.organizationId);

  return {
    mode: "test" as const,
    chargeEnabled: false as const,
    checkoutSessionId: providerRef,
    customerTestId,
    plan: input.plan,
    amountCents,
    simulated: true,
    message: "Test checkout created. Confirm with billing_test_confirm to apply the plan without charging.",
  };
}

export async function confirmTestCheckout(input: {
  organizationId: string;
  actorEmail: string;
  actorRole: OrgRole;
  plan: IrisPlanId;
  checkoutSessionId: string;
  env?: EnvLike;
}) {
  if (!canAdminOrg(input.actorRole)) throw new Error("Administrator access required");
  const billing = getBillingProvider(input.env || {});
  if (!billing.testMode) throw new Error("Test billing is not enabled");
  if (!PLAN_LIMITS[input.plan]) throw new Error("Unknown plan");

  const now = new Date().toISOString();
  const amountCents = (PLAN_LIMITS[input.plan].priceUsdMonthly || 0) * 100;
  await getDb().update(organizations).set({
    plan: input.plan,
    budgetCentsMonthly: PLAN_LIMITS[input.plan].defaultBudgetCents,
    billingMode: "test",
    subscriptionStatus: "test_active",
    updatedAt: now,
  }).where(eq(organizations.id, input.organizationId));

  await getDb().insert(organizationBillingEvents).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    actorEmail: input.actorEmail.trim().toLowerCase(),
    kind: "test_checkout_confirmed",
    plan: input.plan,
    amountCents,
    mode: "test",
    providerRef: input.checkoutSessionId,
    metadata: JSON.stringify({ chargeEnabled: false, charged: false, simulated: true }),
    createdAt: now,
  });

  await logAudit(input.actorEmail, "BILLING_TEST_CONFIRMED", input.organizationId, "SUCCESS", {
    plan: input.plan,
    checkoutSessionId: input.checkoutSessionId,
    charged: false,
  }, input.organizationId);

  return {
    plan: input.plan,
    subscriptionStatus: "test_active" as const,
    chargeEnabled: false as const,
    charged: false as const,
    budgetCentsMonthly: PLAN_LIMITS[input.plan].defaultBudgetCents,
  };
}

export type { BillingProvider as BillingProviderType };
