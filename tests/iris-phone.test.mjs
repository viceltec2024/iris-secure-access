import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("IRIS phone debit uses official checkout and never invents carrier billing", () => {
  const panel = readFileSync(new URL("../app/dashboard/iris-phone-debit.tsx", import.meta.url), "utf8");
  const operations = readFileSync(new URL("../app/dashboard/security-operations.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(panel, /PHONE_DEBIT_PRESETS/);
  assert.match(panel, /\/api\/iris-purchases/);
  assert.match(panel, /IRIS no debita sola|IRIS does not debit alone/);
  assert.doesNotMatch(panel, /telcel|claro|movistar|stripe|oauth/i);
  assert.match(operations, /IrisPhoneDebit/);
  assert.match(operations, /Débito/);
  assert.match(operations, /iris-phone-dock/);
  assert.match(operations, /iris-open-ask/);
  assert.match(operations, /Añadir a pantalla de inicio|Add to Home Screen/);
  assert.match(layout, /viewportFit: "cover"/);
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /manifest.webmanifest/);
  const chat = readFileSync(new URL("../app/dashboard/ask-iris-panel.tsx", import.meta.url), "utf8");
  assert.match(chat, /useState\(false\)/);
  assert.match(chat, /iris-open-ask/);
  const connect = readFileSync(new URL("../app/local-connect.tsx", import.meta.url), "utf8");
  assert.match(connect, /Conectando con IRIS/);
  assert.match(connect, /Entrar desde el teléfono/);
});
