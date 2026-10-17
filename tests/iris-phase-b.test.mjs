import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getBillingProvider } from "../lib/iris-billing-core.ts";
import {
  assertNoSecretsInPayload,
  containsPossibleSecret,
  redactSecrets,
  maskSecretPresence,
} from "../lib/iris-secret-hygiene.ts";
import {
  inviteRoleAllowed,
  normalizeOrgKeyScopes,
  sanitizeInviteRole,
} from "../lib/iris-tenant-core.ts";

test("billing: test mode never enables real charges; live keys blocked", () => {
  const off = getBillingProvider({});
  assert.equal(off.chargeEnabled, false);
  assert.equal(off.mode, "off");

  const testMode = getBillingProvider({ IRIS_BILLING_TEST: "1" });
  assert.equal(testMode.chargeEnabled, false);
  assert.equal(testMode.testMode, true);
  assert.equal(testMode.mode, "test");

  const liveBlocked = getBillingProvider({
    IRIS_BILLING_TEST: "1",
    STRIPE_SECRET_KEY: "sk_live_BLOCKED_FOR_TEST_SHAPE_ONLY_xxxxx",
  });
  assert.equal(liveBlocked.chargeEnabled, false);
  assert.equal(liveBlocked.mode, "blocked_live");

  const liveFlag = getBillingProvider({ IRIS_BILLING_LIVE: "1" });
  assert.equal(liveFlag.mode, "blocked_live");
  assert.equal(liveFlag.chargeEnabled, false);
});

test("secret hygiene redacts and rejects provider key material", () => {
  assert.equal(containsPossibleSecret("hello"), false);
  assert.equal(containsPossibleSecret("sk-abcdefghijklmnopqrstuvwxyz1234"), true);
  assert.match(redactSecrets("key sk-abcdefghijklmnopqrstuvwxyz1234 end"), /\[REDACTED\]/);
  assert.equal(assertNoSecretsInPayload({ ok: true, plan: "starter" }), true);
  assert.throws(() => assertNoSecretsInPayload({ key: "sk-abcdefghijklmnopqrstuvwxyz1234" }));
  assert.equal(maskSecretPresence("").configured, false);
  assert.equal(maskSecretPresence("abcd1234xyz").configured, true);
});

test("invite roles never allow OWNER via invite", () => {
  assert.equal(sanitizeInviteRole("OWNER"), "OPERATOR");
  assert.equal(sanitizeInviteRole("ADMIN"), "ADMIN");
  assert.equal(inviteRoleAllowed("VIEWER"), true);
  assert.equal(inviteRoleAllowed("OWNER"), false);
});

test("org api key scopes normalize safely", () => {
  assert.deepEqual(normalizeOrgKeyScopes(undefined), ["read"]);
  assert.deepEqual(normalizeOrgKeyScopes(["missions", "read", "evil"]), ["missions", "read"]);
});

test("phase B migration and APIs wire invites, keys, billing test", () => {
  const sql = readFileSync(new URL("../drizzle/0012_saas_phase_b.sql", import.meta.url), "utf8");
  assert.match(sql, /organization_invites/);
  assert.match(sql, /organization_api_keys/);
  assert.match(sql, /organization_billing_events/);
  assert.match(sql, /billing_mode/);

  const route = readFileSync(new URL("../app/api/iris-orgs/route.ts", import.meta.url), "utf8");
  assert.match(route, /action === "invite"/);
  assert.match(route, /action === "accept_invite"/);
  assert.match(route, /action === "create_api_key"/);
  assert.match(route, /action === "billing_test_start"/);
  assert.match(route, /assertNoSecretsInPayload/);
  assert.match(route, /getBillingProvider/);
  const billingCore = readFileSync(new URL("../lib/iris-billing-core.ts", import.meta.url), "utf8");
  assert.match(billingCore, /chargeEnabled:\s*false/);
});

test("org export and list responses must not echo provider env assignment", () => {
  for (const file of [
    "app/api/iris-orgs/route.ts",
    "lib/iris-org-keys.ts",
    "lib/iris-invites.ts",
    "lib/iris-billing.ts",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /OPENAI_API_KEY\s*=\s*['\"][^'\"]+['\"]/);
    assert.doesNotMatch(source, /STRIPE_SECRET_KEY\s*=\s*['\"]sk_(live|test)_[^'\"]+['\"]/);
  }
});
