import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluatePlanLimits,
  PLAN_LIMITS,
  currentUsagePeriod,
  getBillingProvider,
} from "../lib/iris-plans.ts";
import {
  assertTenantKeyIsolation,
  canAdminOrg,
  canMutateOrg,
  orgDeskKey,
  legacyEmailDeskKey,
} from "../lib/iris-tenant-core.ts";

test("tenant desk keys isolate organizations", () => {
  assert.equal(assertTenantKeyIsolation("org-a", "org-b"), true);
  assert.notEqual(orgDeskKey("creator", "org-a"), orgDeskKey("creator", "org-b"));
  assert.notEqual(orgDeskKey("mission", "org-a"), orgDeskKey("mission", "org-b"));
  assert.notEqual(orgDeskKey("memory", "org-a"), orgDeskKey("memory", "org-b"));
  assert.match(orgDeskKey("creator", "acme"), /:org:acme$/);
  assert.match(orgDeskKey("memory", "acme"), /^iris_memory:org:acme$/);
  assert.equal(legacyEmailDeskKey("memory", "a@b.com"), "iris_memory:a@b.com");
  assert.equal(legacyEmailDeskKey("creator", "a@b.com"), "iris_creator_desk:a@b.com");
});

test("org roles: VIEWER cannot mutate; only OWNER/ADMIN can admin", () => {
  assert.equal(canMutateOrg("VIEWER"), false);
  assert.equal(canMutateOrg("OPERATOR"), true);
  assert.equal(canMutateOrg("ADMIN"), true);
  assert.equal(canAdminOrg("OPERATOR"), false);
  assert.equal(canAdminOrg("ADMIN"), true);
  assert.equal(canAdminOrg("OWNER"), true);
});

test("plan limits block mutations when exceeded; reads stay allowed", () => {
  const usage = {
    requests: 5_000,
    tokensIn: 0,
    tokensOut: 0,
    missions: 50,
    agentRuns: 0,
    estimatedCostCents: 2_500,
    agentCount: 3,
  };
  assert.equal(evaluatePlanLimits({
    plan: "starter",
    orgStatus: "ACTIVE",
    budgetCentsMonthly: PLAN_LIMITS.starter.defaultBudgetCents,
    usage,
    action: "read",
  }).allowed, true);

  assert.equal(evaluatePlanLimits({
    plan: "starter",
    orgStatus: "ACTIVE",
    budgetCentsMonthly: PLAN_LIMITS.starter.defaultBudgetCents,
    usage,
    action: "request",
  }).code, "BUDGET_EXCEEDED");

  assert.equal(evaluatePlanLimits({
    plan: "starter",
    orgStatus: "ACTIVE",
    budgetCentsMonthly: 99_999,
    usage: { ...usage, estimatedCostCents: 0, requests: 4_999, missions: 49, agentCount: 2 },
    action: "mission",
  }).allowed, true);

  assert.equal(evaluatePlanLimits({
    plan: "starter",
    orgStatus: "ACTIVE",
    budgetCentsMonthly: 99_999,
    usage: { ...usage, estimatedCostCents: 0, requests: 0, missions: 50 },
    action: "mission",
  }).code, "MISSION_LIMIT");

  assert.equal(evaluatePlanLimits({
    plan: "starter",
    orgStatus: "ACTIVE",
    budgetCentsMonthly: 99_999,
    usage: { ...usage, estimatedCostCents: 0, requests: 0, missions: 0, agentCount: 3 },
    action: "agent_create",
  }).code, "AGENT_LIMIT");

  assert.equal(evaluatePlanLimits({
    plan: "starter",
    orgStatus: "SUSPENDED",
    budgetCentsMonthly: 99_999,
    usage: { ...usage, estimatedCostCents: 0, requests: 0 },
    action: "request",
  }).code, "ORG_SUSPENDED");
});

test("business and enterprise raise seats vs starter", () => {
  assert.ok(PLAN_LIMITS.business.maxAgents > PLAN_LIMITS.starter.maxAgents);
  assert.ok(PLAN_LIMITS.enterprise.maxMissionsPerMonth > PLAN_LIMITS.business.maxMissionsPerMonth);
  assert.match(currentUsagePeriod(), /^\d{4}-\d{2}$/);
});

test("billing provider is stubbed with chargeEnabled false", () => {
  const billing = getBillingProvider();
  assert.equal(billing.chargeEnabled, false);
  assert.equal(billing.id, "none");
});

test("org-scoped product APIs require organization context", () => {
  for (const file of [
    "app/api/iris-creator/route.ts",
    "app/api/iris-mission/route.ts",
    "app/api/iris-coordinator/route.ts",
    "app/api/iris-evals/route.ts",
    "app/api/iris-orgs/route.ts",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /requireOrgContext/);
  }
  const orgStore = readFileSync(new URL("../lib/iris-org-store.ts", import.meta.url), "utf8");
  assert.match(orgStore, /orgDeskKey/);
  assert.match(orgStore, /legacyEmailDeskKey/);
  assert.match(orgStore, /iris_legacy_migrated/);
});

test("migration 0011 defines organizations and usage tables", () => {
  const sql = readFileSync(new URL("../drizzle/0011_saas_organizations.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE `organizations`/);
  assert.match(sql, /CREATE TABLE `organization_members`/);
  assert.match(sql, /CREATE TABLE `organization_usage_monthly`/);
  assert.match(sql, /CREATE TABLE `usage_events`/);
  assert.match(sql, /ALTER TABLE `audit_events` ADD `organization_id`/);
});
