import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("enterprise skin keeps Inter and does not restore Geist", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /fonts\.googleapis\.com\/css2\?family=Inter/);
  assert.match(css, /--iris-cyan:/);
  assert.match(css, /--iris-radius-lg:/);
  assert.match(css, /\.auth-glass\{/);
  assert.match(css, /\.soc-atmosphere\{/);
  assert.doesNotMatch(css, /Geist|geist-latin|vinext/i);
});

test("landing page uses Spanish enterprise command copy", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /iris-enterprise/);
  assert.match(page, /Centro de mando seguro/);
  assert.match(page, /Acceso seguro/);
  assert.match(page, /Entrar al espacio IRIS/);
  assert.match(page, /Identidad protegida por OpenAI/);
  assert.doesNotMatch(page, /Secure Command Gateway/);
});
