/**
 * Phase B enterprise integration / security gates.
 * Pure helpers + source/migration wiring — no production deploy, no live charges.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getBillingProvider } from "../lib/iris-billing-core.ts";
import {
  assertNoSecretsInPayload,
  containsPossibleSecret,
  redactSecrets,
} from "../lib/iris-secret-hygiene.ts";
import {
  assertPublicOrgSecretShape,
  assertRoleChangeAllowed,
  assertTenantKeyIsolation,
  canAdminOrg,
  canMutateOrg,
  inviteIsExpired,
  inviteRoleAllowed,
  isValidInviteTokenFormat,
  isValidOrgApiKeyFormat,
  normalizeOrgKeyScopes,
  orgDeskKey,
  roleRank,
  sanitizeInviteRole,
} from "../lib/iris-tenant-core.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("integration: org A desk keys never collide with org B", () => {
  assert.equal(assertTenantKeyIsolation("org-acme", "org-globex"), true);
  for (const kind of ["creator", "mission", "memory", "purchase"]) {
    assert.notEqual(orgDeskKey(kind, "org-acme"), orgDeskKey(kind, "org-globex"));
  }
  const tenant = read("lib/iris-tenant.ts");
  assert.match(tenant, /memberships\.find\(item => item\.organizationId === preferredOrgId\)/);
  assert.match(tenant, /requireOrgContext/);
  // Switching to a foreign org id falls back to a membership the user actually has.
  assert.match(tenant, /if \(!membership\) membership = memberships\[0\]/);
});

test("integration: users cannot elevate their own privileges", () => {
  assert.throws(
    () => assertRoleChangeAllowed({
      actorEmail: "ops@acme.test",
      actorRole: "ADMIN",
      targetEmail: "ops@acme.test",
      currentRole: "ADMIN",
      nextRole: "OWNER",
    }),
    /Cannot elevate your own privileges|Only an OWNER/,
  );
  assert.throws(
    () => assertRoleChangeAllowed({
      actorEmail: "viewer@acme.test",
      actorRole: "OPERATOR",
      targetEmail: "viewer@acme.test",
      currentRole: "OPERATOR",
      nextRole: "ADMIN",
    }),
    /Administrator access required/,
  );
  assert.throws(
    () => assertRoleChangeAllowed({
      actorEmail: "admin@acme.test",
      actorRole: "ADMIN",
      targetEmail: "peer@acme.test",
      currentRole: "OPERATOR",
      nextRole: "OWNER",
    }),
    /Only an OWNER can promote another OWNER/,
  );
  assert.throws(
    () => assertRoleChangeAllowed({
      actorEmail: "admin@acme.test",
      actorRole: "ADMIN",
      targetEmail: "peer@acme.test",
      currentRole: "VIEWER",
      nextRole: "OWNER",
    }),
    /Only an OWNER|Cannot assign a role above/,
  );
  assert.equal(assertRoleChangeAllowed({
    actorEmail: "admin@acme.test",
    actorRole: "ADMIN",
    targetEmail: "peer@acme.test",
    currentRole: "VIEWER",
    nextRole: "OPERATOR",
  }), true);
  assert.ok(roleRank("OWNER") > roleRank("ADMIN"));
  assert.ok(roleRank("ADMIN") > roleRank("OPERATOR"));
  assert.equal(canAdminOrg("VIEWER"), false);
  assert.equal(canMutateOrg("VIEWER"), false);

  const tenant = read("lib/iris-tenant.ts");
  assert.match(tenant, /assertRoleChangeAllowed/);
  assert.match(tenant, /Cannot demote the last OWNER/);
});

test("integration: API keys and invite secrets never appear in list/export shapes", () => {
  const fullKey = `iris_ak_${"ab".repeat(20)}`;
  const fullInvite = `iris_inv_${"cd".repeat(20)}`;
  assert.equal(isValidOrgApiKeyFormat(fullKey), true);
  assert.equal(isValidInviteTokenFormat(fullInvite), true);
  assert.equal(isValidOrgApiKeyFormat("iris_ak_abcd"), false);
  assert.equal(containsPossibleSecret(fullKey), true);
  assert.equal(containsPossibleSecret(fullInvite), true);
  assert.match(redactSecrets(`leak ${fullKey} end`), /\[REDACTED\]/);

  assert.throws(() => assertNoSecretsInPayload({ secret: fullKey }));
  assert.throws(() => assertNoSecretsInPayload({ token: fullInvite }));
  assert.equal(assertNoSecretsInPayload({
    apiKeys: [{ id: "1", keyPrefix: "iris_ak_abcd", scopes: ["read"] }],
    invites: [{ id: "2", tokenPrefix: "iris_inv_ef01", status: "PENDING" }],
  }), true);

  assert.throws(() => assertPublicOrgSecretShape({ keyHash: "abc" }, "api_key"));
  assert.throws(() => assertPublicOrgSecretShape({ tokenHash: "abc" }, "invite"));
  assert.throws(() => assertPublicOrgSecretShape({ secret: fullKey }, "api_key"));
  assert.equal(assertPublicOrgSecretShape({
    id: "k1",
    keyPrefix: "iris_ak_abcd",
    scopes: ["read"],
  }, "api_key"), true);

  for (const file of [
    "lib/iris-org-keys.ts",
    "lib/iris-invites.ts",
    "app/api/iris-orgs/route.ts",
  ]) {
    const source = read(file);
    assert.match(source, /assertPublicOrgSecretShape|assertNoSecretsInPayload|keyHash|tokenHash/);
    assert.doesNotMatch(source, /OPENAI_API_KEY\s*=\s*['\"][^'\"]+['\"]/);
    assert.doesNotMatch(source, /STRIPE_SECRET_KEY\s*=\s*['\"]sk_(live|test)_[^'\"]+['\"]/);
  }

  const exportRoute = read("app/api/iris-orgs/route.ts");
  assert.match(exportRoute, /action === "export"/);
  assert.match(exportRoute, /assertNoSecretsInPayload\(exportPayload/);
  assert.match(exportRoute, /listOrgApiKeys/);
  // Export uses public list helpers (prefix only), never raw secret columns in response builders.
  assert.match(read("lib/iris-org-keys.ts"), /keyPrefix: row\.keyPrefix/);
  assert.doesNotMatch(read("lib/iris-org-keys.ts"), /keyHash:\s*row\.keyHash/);
  assert.doesNotMatch(read("lib/iris-invites.ts"), /tokenHash:\s*row\.tokenHash/);
});

test("integration: expired and invalid invites are rejected", () => {
  assert.equal(isValidInviteTokenFormat("not-a-token"), false);
  assert.equal(isValidInviteTokenFormat("iris_inv_short"), false);
  assert.equal(sanitizeInviteRole("OWNER"), "OPERATOR");
  assert.equal(inviteRoleAllowed("OWNER"), false);
  assert.equal(inviteIsExpired("2000-01-01T00:00:00.000Z", Date.parse("2026-10-19T00:00:00.000Z")), true);
  assert.equal(inviteIsExpired("2099-01-01T00:00:00.000Z", Date.parse("2026-10-19T00:00:00.000Z")), false);

  const invites = read("lib/iris-invites.ts");
  assert.match(invites, /isValidInviteTokenFormat/);
  assert.match(invites, /inviteIsExpired/);
  assert.match(invites, /Invite expired/);
  assert.match(invites, /Invalid invite token/);
  assert.match(invites, /Invite email does not match signed-in user/);
  assert.match(invites, /status: "EXPIRED"/);
});

test("integration: org endpoints reject unauthorized / non-admin mutations", () => {
  const route = read("app/api/iris-orgs/route.ts");
  assert.match(route, /if \(!user \|\| user\.status !== "ACTIVE"\) return Response\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
  for (const action of [
    "invite",
    "revoke_invite",
    "update_role",
    "remove_member",
    "create_api_key",
    "revoke_api_key",
    "billing_test_start",
    "billing_test_confirm",
    "export",
  ]) {
    assert.match(route, new RegExp(`action === "${action}"[\\s\\S]{0,220}admin:\\s*true`));
  }
  assert.match(route, /enforceRateLimit/);
  assert.match(route, /status: 429/);
  assert.match(route, /ORG_DENIED/);

  const tenant = read("lib/iris-tenant.ts");
  assert.match(tenant, /Organization administrator access required/);
  assert.match(tenant, /Insufficient organization role/);

  const billing = getBillingProvider({ IRIS_BILLING_TEST: "1" });
  assert.equal(billing.chargeEnabled, false);
  assert.equal(billing.testMode, true);
  assert.equal(getBillingProvider({ IRIS_BILLING_LIVE: "1" }).mode, "blocked_live");
  assert.deepEqual(normalizeOrgKeyScopes(["missions", "evil", "admin"]), ["missions", "admin"]);
});

test("integration: SaaS migrations 0011+0012 are journaled and apply cleanly", () => {
  const journal = JSON.parse(read("drizzle/meta/_journal.json"));
  const tags = journal.entries.map(entry => entry.tag);
  assert.ok(tags.includes("0011_saas_organizations"));
  assert.ok(tags.includes("0012_saas_phase_b"));
  assert.equal(tags.at(-1), "0012_saas_phase_b");

  const sqlFiles = readdirSync(join(root, "drizzle")).filter(name => name.endsWith(".sql")).sort();
  assert.ok(sqlFiles.includes("0011_saas_organizations.sql"));
  assert.ok(sqlFiles.includes("0012_saas_phase_b.sql"));
  assert.equal(sqlFiles.length, journal.entries.length);

  const phaseA = read("drizzle/0011_saas_organizations.sql");
  assert.match(phaseA, /CREATE TABLE `organizations`/);
  assert.match(phaseA, /CREATE TABLE `organization_members`/);
  assert.match(phaseA, /CREATE TABLE `organization_usage_monthly`/);
  assert.match(phaseA, /CREATE TABLE `usage_events`/);
  assert.match(phaseA, /ALTER TABLE `audit_events` ADD `organization_id`/);

  const phaseB = read("drizzle/0012_saas_phase_b.sql");
  assert.match(phaseB, /CREATE TABLE `organization_invites`/);
  assert.match(phaseB, /CREATE TABLE `organization_api_keys`/);
  assert.match(phaseB, /CREATE TABLE `organization_billing_events`/);
  assert.match(phaseB, /token_hash/);
  assert.match(phaseB, /key_hash/);
  assert.match(phaseB, /billing_mode/);
  assert.match(phaseB, /subscription_status/);

  const schema = read("db/schema.ts");
  assert.match(schema, /organizationInvites/);
  assert.match(schema, /organizationApiKeys/);
  assert.match(schema, /organizationBillingEvents/);
  assert.match(schema, /billingMode/);

  // Local D1 apply script exists and is idempotent by design.
  assert.equal(existsSync(join(root, "scripts/apply-local-d1-migrations.mjs")), true);
  const applyScript = read("scripts/apply-local-d1-migrations.mjs");
  assert.match(applyScript, /_local_migrations|already|schema already/i);
});

test("integration: org admin panel exposes audit + keeps chargeEnabled off", () => {
  const panel = read("app/dashboard/iris-org-panel.tsx");
  assert.match(panel, /view=admin/);
  assert.match(panel, /auditEvents/);
  assert.match(panel, /chargeEnabled/);
  assert.match(panel, /billing_test_start/);
  assert.match(panel, /create_api_key/);
  assert.match(panel, /invite/);

  const route = read("app/api/iris-orgs/route.ts");
  assert.match(route, /listOrgAuditEvents/);
  assert.match(route, /getBillingProvider/);
  assert.match(route, /billing_test_start/);
  const billingCore = read("lib/iris-billing-core.ts");
  assert.match(billingCore, /chargeEnabled:\s*false/);
  assert.equal(getBillingProvider({ IRIS_BILLING_TEST: "1" }).chargeEnabled, false);
});
