import assert from "node:assert/strict";
import test from "node:test";
import {
  IRIS_PRODUCTION_ORIGIN,
  irisReconnectOrigin,
  isLoopbackHost,
  isPrivateLanHost,
  isPublicAgentPath,
  passkeyRelyingParty,
} from "../lib/iris-origin.ts";

test("loopback reconnect copies a public origin, never 127.0.0.1", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isPrivateLanHost("10.1.2.3"), true);
  assert.equal(
    irisReconnectOrigin("http://127.0.0.1:5173", "https://iris.example"),
    "https://iris.example",
  );
  assert.equal(irisReconnectOrigin("http://localhost:5173"), IRIS_PRODUCTION_ORIGIN);
  assert.doesNotMatch(irisReconnectOrigin("http://127.0.0.1:5173"), /127\.0\.0\.1|localhost/);
});

test("a public dashboard origin wins over a stale public override", () => {
  assert.equal(
    irisReconnectOrigin(
      "https://alive-tunnel.trycloudflare.com",
      IRIS_PRODUCTION_ORIGIN,
    ),
    "https://alive-tunnel.trycloudflare.com",
  );
  assert.equal(
    irisReconnectOrigin("https://iris-secure-access.taylor-667.chatgpt.site"),
    IRIS_PRODUCTION_ORIGIN,
  );
});

test("same-LAN hosts stay reachable when no public origin is configured", () => {
  assert.equal(irisReconnectOrigin("http://192.168.1.20:5173"), "http://192.168.1.20:5173");
  assert.equal(
    irisReconnectOrigin("http://192.168.1.20:5173", "https://iris.example"),
    "https://iris.example",
  );
});

test("passkey relying party follows the request origin", () => {
  const local = passkeyRelyingParty("http://127.0.0.1:5173/api/passkeys/auth/options");
  assert.equal(local.rpID, "127.0.0.1");
  assert.equal(local.origin, "http://127.0.0.1:5173");
  assert.equal(local.secureCookie, false);
  const production = passkeyRelyingParty(`${IRIS_PRODUCTION_ORIGIN}/api/passkeys/auth/options`);
  assert.equal(production.rpID, "iris-secure-access.taylor-667.chatgpt.site");
  assert.equal(production.origin, IRIS_PRODUCTION_ORIGIN);
  assert.equal(production.secureCookie, true);
  const loopbackV6 = passkeyRelyingParty("http://[::1]:5173/dashboard");
  assert.equal(loopbackV6.rpID, "localhost");
});

test("Mac agent script and check-in are public agent paths", () => {
  assert.equal(isPublicAgentPath("/api/agent/check-in"), true);
  assert.equal(isPublicAgentPath("/iris-agent-macos.sh"), true);
  assert.equal(isPublicAgentPath("/dashboard"), false);
  assert.equal(isPublicAgentPath("/api/security-state"), false);
});
