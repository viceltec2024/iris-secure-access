import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { canEnrollFactor, STEP_UP_REQUIRED_CODE, stepUpRequiredBody, stepUpSatisfied } from "../lib/iris-step-up-core.ts";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

function routeFiles(dir) {
  const out = [];
  for (const name of readdirSync(new URL(dir, root))) {
    const path = `${dir}/${name}`;
    if (statSync(new URL(path, root)).isDirectory()) out.push(...routeFiles(path));
    else if (name === "route.ts") out.push(path);
  }
  return out;
}

// Rutas que no usan la identidad de ChatGPT, o que son los propios factores.
const FACTOR_ROUTES = new Set([
  "app/api/passkeys/auth/options/route.ts",
  "app/api/passkeys/auth/verify/route.ts",
  "app/api/passkeys/register/options/route.ts",
  "app/api/passkeys/register/verify/route.ts",
  "app/api/password/change/route.ts",
  "app/api/password/setup/route.ts",
  "app/api/password/verify/route.ts",
]);
const ENROLLMENT_ROUTES = [
  "app/api/passkeys/register/options/route.ts",
  "app/api/passkeys/register/verify/route.ts",
  "app/api/password/setup/route.ts",
];

test("step-up: sin factor inscrito no se exige verificación", () => {
  assert.equal(stepUpSatisfied({ devSkip: false, factorEnrolled: false, verified: false }), true);
});

test("step-up: con factor inscrito y sin verificar se bloquea", () => {
  assert.equal(stepUpSatisfied({ devSkip: false, factorEnrolled: true, verified: false }), false);
  assert.equal(stepUpSatisfied({ devSkip: false, factorEnrolled: true, verified: true }), true);
});

test("step-up: el modo local IRIS_DEV_SKIP_STEPUP lo omite", () => {
  assert.equal(stepUpSatisfied({ devSkip: true, factorEnrolled: true, verified: false }), true);
});

test("inscribir un segundo factor exige verificar el primero", () => {
  assert.equal(canEnrollFactor({ devSkip: false, factorEnrolled: false, verified: false }), true);
  assert.equal(canEnrollFactor({ devSkip: false, factorEnrolled: true, verified: false }), false);
  assert.equal(canEnrollFactor({ devSkip: false, factorEnrolled: true, verified: true }), true);
});

test("la respuesta de step-up está en español por defecto y lleva código estable", () => {
  const body = stepUpRequiredBody();
  assert.equal(body.code, STEP_UP_REQUIRED_CODE);
  assert.equal(body.stepUpRequired, true);
  assert.match(body.error, /Verifica tu identidad/);
  assert.match(stepUpRequiredBody("en").error, /Verify your identity/);
});

test("toda ruta /api con identidad de ChatGPT exige step-up después del control de estado", () => {
  const routes = routeFiles("app/api").filter(path => read(path).includes("getChatGPTUser") && !FACTOR_ROUTES.has(path));
  assert.ok(routes.length >= 19, `se esperaban al menos 19 rutas, hay ${routes.length}`);
  for (const path of routes) {
    const source = read(path);
    assert.match(source, /import \{ requireStepUp \} from "(\.\.\/)+lib\/iris-step-up";/, `${path} no importa requireStepUp`);
    const statusChecks = (source.match(/user\.status !== "ACTIVE"/g) || []).length;
    const stepUps = (source.match(/await requireStepUp\(user\.email\)/g) || []).length;
    assert.ok(stepUps >= 1, `${path} no llama a requireStepUp`);
    assert.equal(stepUps, statusChecks, `${path}: cada handler con control de estado debe exigir step-up`);
  }
});

test("las rutas de inscripción de factores exigen verificar el factor existente", () => {
  for (const path of ENROLLMENT_ROUTES) {
    const source = read(path);
    assert.match(source, /await requireFactorEnrollment\(user\.email\)/, path);
    assert.match(source, /existing_factor_not_verified/, path);
  }
});

test("un usuario suspendido no puede verificar ni inscribir factores", () => {
  for (const path of FACTOR_ROUTES) assert.match(read(path), /suspendedResponse\(user\.status\)/, path);
});

test("dashboard y administración usan la misma regla de step-up", () => {
  assert.match(read("app/dashboard/page.tsx"), /stepUpState\(user\.email\)/);
  assert.match(read("app/admin/users/page.tsx"), /stepUpSatisfied\(await stepUpState\(actor\.email\)\)/);
  assert.match(read("app/admin/users/actions.ts"), /stepUpSatisfied\(await stepUpState\(actor\.email\)\)/);
});

test("agent-orchestration espera a findIrisUser antes de caer en provisionIrisUser", () => {
  const source = read("app/api/agent-orchestration/status/route.ts");
  assert.match(source, /\(await findIrisUser\(identity\)\) \?\? provisionIrisUser\(identity\)/);
});
