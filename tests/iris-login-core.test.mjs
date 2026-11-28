import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_GENERIC_ERROR,
  normalizeLoginEmail,
  ownerBootstrapAllowed,
  ownerBootstrapMessage,
  passkeyLoginChallengeKey,
  sameOriginRequest,
  timingSafeStringEqual,
  validPasswordInput,
} from "../lib/iris-login-core.ts";

const base = {
  email: "owner@iris.example",
  ownerEmail: "Owner@Iris.example",
  configuredSetupCode: "codigo-secreto-de-16+",
  providedSetupCode: "codigo-secreto-de-16+",
  passwordAlreadyConfigured: false,
  password: "una contraseña larga",
  confirmation: "una contraseña larga",
};

test("emails are normalized and junk is rejected", () => {
  assert.equal(normalizeLoginEmail("  Ana@Ejemplo.COM "), "ana@ejemplo.com");
  for (const bad of ["", "ana", "ana@", "@x.com", "a b@x.com", 42, null, "a@b"]) assert.equal(normalizeLoginEmail(bad), null);
  assert.equal(validPasswordInput("x".repeat(129)), false);
  assert.equal(validPasswordInput(""), false);
  assert.equal(validPasswordInput("secreto"), true);
});

test("owner bootstrap only works for the owner, with the right code, once", () => {
  assert.deepEqual(ownerBootstrapAllowed(base), { allowed: true });
  assert.equal(ownerBootstrapAllowed({ ...base, configuredSetupCode: "" }).reason, "setup_disabled");
  assert.equal(ownerBootstrapAllowed({ ...base, configuredSetupCode: "corto" }).reason, "setup_disabled");
  assert.equal(ownerBootstrapAllowed({ ...base, email: "otro@iris.example" }).reason, "not_owner");
  assert.equal(ownerBootstrapAllowed({ ...base, ownerEmail: "" }).reason, "not_owner");
  assert.equal(ownerBootstrapAllowed({ ...base, providedSetupCode: "codigo-secreto-de-16-" }).reason, "bad_code");
  assert.equal(ownerBootstrapAllowed({ ...base, passwordAlreadyConfigured: true }).reason, "already_configured");
  assert.equal(ownerBootstrapAllowed({ ...base, password: "corta", confirmation: "corta" }).reason, "weak_password");
  assert.equal(ownerBootstrapAllowed({ ...base, confirmation: "otra contraseña larga" }).reason, "mismatch");
});

test("bootstrap errors do not reveal whether the email or the code was wrong", () => {
  assert.equal(ownerBootstrapMessage("not_owner"), ownerBootstrapMessage("bad_code"));
  assert.equal(ownerBootstrapMessage("bad_code"), ownerBootstrapMessage("setup_disabled"));
  assert.match(LOGIN_GENERIC_ERROR, /Correo o contraseña incorrectos/);
});

test("constant-time compare and same-origin check", () => {
  assert.equal(timingSafeStringEqual("abc", "abc"), true);
  assert.equal(timingSafeStringEqual("abc", "abd"), false);
  assert.equal(timingSafeStringEqual("abc", "abcd"), false);
  assert.equal(sameOriginRequest("https://iris.example/api/session/login", "https://iris.example"), true);
  assert.equal(sameOriginRequest("https://iris.example/api/session/login", "https://evil.example"), false);
  assert.equal(sameOriginRequest("https://iris.example/api/session/login", null), false);
  assert.equal(sameOriginRequest("https://iris.example/api/session/login", "not a url"), false);
});

test("passkey login challenge keys never look like an email", () => {
  const key = passkeyLoginChallengeKey(crypto.randomUUID());
  assert.ok(key?.startsWith("passkey-login:"));
  assert.equal(normalizeLoginEmail(key), null);
  assert.equal(passkeyLoginChallengeKey("owner@iris.example"), null);
  assert.equal(passkeyLoginChallengeKey(""), null);
});
