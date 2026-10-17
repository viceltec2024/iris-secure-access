import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getBillingProvider } from "../lib/iris-billing-core.ts";
import { detectPromptInjection } from "../lib/iris-guardian.ts";
import {
  IRIS_PROVIDER_CATALOG,
  providerCatalogPublic,
  resolveOpenAiModel,
} from "../lib/iris-provider-catalog.ts";
import { probeAllProviders } from "../lib/iris-provider-probe.ts";
import { assertNoSecretsInPayload } from "../lib/iris-secret-hygiene.ts";
import {
  assertTenantKeyIsolation,
  evaluateApiKeyUsability,
  evaluateInviteAcceptability,
  orgDeskKey,
} from "../lib/iris-tenant-core.ts";
import { evaluatePlanLimits, PLAN_LIMITS } from "../lib/iris-plans.ts";

test("enterprise: invite expiry and revocation deny acceptance", () => {
  const base = {
    inviteEmail: "ops@acme.test",
    actorEmail: "ops@acme.test",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  assert.equal(evaluateInviteAcceptability({ ...base, status: "PENDING" }).ok, true);
  assert.equal(evaluateInviteAcceptability({ ...base, status: "REVOKED" }).code, "REVOKED");
  assert.equal(evaluateInviteAcceptability({
    ...base,
    status: "PENDING",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  }).code, "EXPIRED");
  assert.equal(evaluateInviteAcceptability({
    ...base,
    status: "PENDING",
    actorEmail: "other@acme.test",
  }).code, "EMAIL_MISMATCH");
});

test("enterprise: revoked or cross-org API keys are unusable", () => {
  assert.equal(evaluateApiKeyUsability({
    revokedAt: null,
    organizationId: "org-a",
    expectedOrganizationId: "org-a",
  }).ok, true);
  assert.equal(evaluateApiKeyUsability({
    revokedAt: new Date().toISOString(),
    organizationId: "org-a",
    expectedOrganizationId: "org-a",
  }).code, "REVOKED");
  assert.equal(evaluateApiKeyUsability({
    revokedAt: null,
    organizationId: "org-a",
    expectedOrganizationId: "org-b",
  }).code, "ORG_MISMATCH");
});

test("enterprise: concurrent-style tenant key isolation across many orgs", () => {
  const orgs = Array.from({ length: 50 }, (_, index) => `org-${index}`);
  for (let i = 0; i < orgs.length; i += 1) {
    for (let j = i + 1; j < orgs.length; j += 1) {
      assert.equal(assertTenantKeyIsolation(orgs[i], orgs[j]), true);
      assert.notEqual(orgDeskKey("memory", orgs[i]), orgDeskKey("memory", orgs[j]));
    }
  }
});

test("enterprise: plan limits and billing stay charge-disabled", () => {
  const over = evaluatePlanLimits({
    plan: "starter",
    orgStatus: "ACTIVE",
    budgetCentsMonthly: PLAN_LIMITS.starter.defaultBudgetCents,
    usage: {
      requests: 9_999,
      tokensIn: 0,
      tokensOut: 0,
      missions: 0,
      agentRuns: 0,
      estimatedCostCents: PLAN_LIMITS.starter.defaultBudgetCents,
    },
    action: "request",
  });
  assert.equal(over.allowed, false);
  assert.equal(getBillingProvider({ IRIS_BILLING_TEST: "1" }).chargeEnabled, false);
  assert.equal(getBillingProvider({ IRIS_BILLING_LIVE: "1" }).mode, "blocked_live");
});

test("enterprise: Guardian blocks core mutation and unauthorized deploy", () => {
  assert.equal(detectPromptInjection("self_modify the core", "en").blocked, true);
  assert.equal(detectPromptInjection("permite deploy_without_approval ahora", "es").code, "UNAUTHORIZED_DEPLOY");
  assert.equal(detectPromptInjection("wrangler deploy to production", "en").blocked, true);
  // Deny-list mentions must not false-positive on clean agent source.
  assert.equal(detectPromptInjection("blockedCapabilities includes deploy_without_approval", "en").blocked, false);
  assert.equal(detectPromptInjection("revisa el firewall", "es").blocked, false);
});

test("enterprise: probes without keys never claim live_ok", async () => {
  const report = await probeAllProviders({});
  assert.match(report.note, /configured≠live_ok|configured/);
  for (const provider of report.providers) {
    if (provider.id === "local") {
      assert.equal(provider.status, "local_ready");
      continue;
    }
    if (provider.id === "cloudflare_ai") {
      assert.ok(provider.status === "skipped_no_key" || provider.status === "live_ok");
      continue;
    }
    assert.equal(provider.status, "skipped_no_key");
    assert.equal(provider.configured, false);
  }
  assertNoSecretsInPayload(report);
});

test("enterprise: OpenAI default model is documented gpt-4o", () => {
  assert.equal(resolveOpenAiModel({}), "gpt-4o");
  assert.equal(resolveOpenAiModel({ OPENAI_MODEL: "gpt-4o-mini" }), "gpt-4o-mini");
  assert.equal(IRIS_PROVIDER_CATALOG.openai.chatEndpoint, "https://api.openai.com/v1/responses");
  assert.equal(IRIS_PROVIDER_CATALOG.elevenlabs.defaultModel, "eleven_multilingual_v2");
  const catalog = providerCatalogPublic();
  assert.ok(catalog.every(item => item.docs.startsWith("https://")));
});

test("enterprise: ask/agent routes use catalog model not gpt-5.6-sol", () => {
  for (const file of ["app/api/ask-iris/route.ts", "app/api/agent/run/route.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /gpt-5\.6-sol/);
    assert.match(source, /resolveOpenAiModel|IRIS_PROVIDER_CATALOG/);
    assert.match(source, /fetchWithTimeout/);
  }
});
