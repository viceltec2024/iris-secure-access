import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activeLessons,
  appendMemory,
  decideLessonPromotion,
  emptyMemoryStore,
  memoryAllowsSelfModify,
  parseMemoryStore,
  searchMemory,
} from "../lib/iris-memory.ts";
import { CONCURRENT_UPDATE, isConcurrencyError, nextCasTimestamp, runCasMutation } from "../lib/iris-cas-core.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const note = (id, extra = {}) => ({
  id, kind: "operator_note", title: `nota ${id}`, body: "cuerpo", tags: ["n"],
  createdAt: "2026-11-26T00:00:00.000Z", createdBy: "owner@iris.local", promotion: "none", ...extra,
});
const lesson = (id, extra = {}) => note(id, { kind: "lesson", promotion: "pending", ...extra });

// --- memoria

test("una lección aprobada no se pierde al superar el tope de 200 registros", () => {
  let store = appendMemory(emptyMemoryStore(), lesson("L1"));
  store = decideLessonPromotion(store, "L1", "approve", "owner@iris.local").store;
  for (let i = 0; i < 260; i += 1) store = appendMemory(store, note(`n${i}`));
  assert.equal(store.records.length, 200);
  assert.deepEqual(activeLessons(store).map(item => item.id), ["L1"]);
  assert.equal(store.records[0].id, "n259", "lo más reciente sigue primero");
});

test("las lecciones pendientes tampoco se descartan por el tope", () => {
  let store = appendMemory(emptyMemoryStore(), lesson("P1"));
  for (let i = 0; i < 250; i += 1) store = appendMemory(store, note(`n${i}`));
  assert.ok(store.records.some(item => item.id === "P1" && item.promotion === "pending"));
});

test("no se puede añadir una lección ya aprobada: queda pendiente de un humano", () => {
  const store = appendMemory(emptyMemoryStore(), lesson("X", { promotion: "approved", promotedBy: "bot", promotedAt: "now" }));
  assert.equal(store.records[0].promotion, "pending");
  assert.equal(store.records[0].promotedBy, undefined);
  assert.equal(activeLessons(store).length, 0);
});

test("un registro que no es lección nunca queda como aprobado", () => {
  const store = appendMemory(emptyMemoryStore(), note("E", { kind: "eval_result", promotion: "approved" }));
  assert.equal(store.records[0].promotion, "none");
});

test("ids duplicados se rechazan", () => {
  const store = appendMemory(emptyMemoryStore(), note("A"));
  assert.throws(() => appendMemory(store, note("A")), /duplicate_memory_id/);
});

test("una memoria guardada con tags corruptos no rompe la búsqueda", () => {
  const raw = JSON.stringify({ revision: 3, records: [note("A", { tags: "firewall" }), note("B", { tags: null, body: "firewall activo" })] });
  const store = parseMemoryStore(raw);
  assert.deepEqual(store.records.map(item => item.tags), [[], []]);
  assert.deepEqual(searchMemory(store, "firewall").map(item => item.id), ["B"]);
});

test("al leer, una lección 'aprobada' sin humano vuelve a pendiente y se quitan duplicados", () => {
  const raw = JSON.stringify({ records: [lesson("L", { promotion: "approved" }), lesson("L"), note("N", { promotion: "approved" })] });
  const store = parseMemoryStore(raw);
  assert.equal(store.records.length, 2);
  assert.equal(store.records[0].promotion, "pending");
  assert.equal(store.records[1].promotion, "none");
  assert.equal(activeLessons(store).length, 0);
});

test("la memoria sigue sin autorizar la auto-modificación del núcleo", () => {
  assert.equal(memoryAllowsSelfModify(), false);
});

// --- CAS

function fakeStore(initial = "") {
  const state = { value: initial, updatedAt: initial ? "2026-11-26T00:00:00.000Z" : null, writes: 0 };
  return {
    state,
    load: async () => ({ value: state.value, updatedAt: state.updatedAt }),
    save: async (value, expected) => {
      if (expected !== state.updatedAt) return false;
      state.value = value;
      state.updatedAt = nextCasTimestamp(expected, new Date(Date.parse(expected || "2026-11-26T00:00:00.000Z")));
      state.writes += 1;
      return true;
    },
  };
}

test("un conflicto vuelve a aplicar la mutación sobre el valor nuevo (no pisa)", async () => {
  const store = fakeStore(JSON.stringify(appendMemory(emptyMemoryStore(), lesson("L1"))));
  let first = true;
  const result = await runCasMutation({
    load: store.load,
    save: async (value, expected) => {
      if (first) {
        // Mientras tanto, un humano aprueba la lección.
        first = false;
        const approved = decideLessonPromotion(parseMemoryStore(store.state.value), "L1", "approve", "owner@iris.local").store;
        await store.save(JSON.stringify(approved), store.state.updatedAt);
      }
      return store.save(value, expected);
    },
    mutate: value => {
      const next = appendMemory(parseMemoryStore(value), note("M1"));
      return { value: JSON.stringify(next), result: next };
    },
  });
  const saved = parseMemoryStore(store.state.value);
  assert.deepEqual(saved.records.map(item => item.id), ["M1", "L1"]);
  assert.equal(activeLessons(saved).length, 1, "la aprobación humana sobrevive");
  assert.equal(result.records.length, 2);
});

test("tras varios conflictos seguidos se lanza concurrent_update", async () => {
  await assert.rejects(
    runCasMutation({ load: async () => ({ value: "", updatedAt: null }), save: async () => false, mutate: () => ({ value: "x", result: 1 }), attempts: 3 }),
    error => error.message === CONCURRENT_UPDATE && isConcurrencyError(error),
  );
});

test("el sello CAS siempre avanza, aunque el reloj no", () => {
  const stamp = "2026-11-26T10:00:00.000Z";
  assert.equal(nextCasTimestamp(stamp, new Date(stamp)), "2026-11-26T10:00:00.001Z");
  assert.equal(nextCasTimestamp(stamp, new Date("2026-11-26T09:00:00.000Z")), "2026-11-26T10:00:00.001Z");
  assert.equal(nextCasTimestamp(stamp, new Date("2026-11-26T11:00:00.000Z")), "2026-11-26T11:00:00.000Z");
  assert.equal(nextCasTimestamp(null, new Date(stamp)), stamp);
});

test("saveOrgDeskValue ya no reintenta pisando con el mismo valor", () => {
  const source = read("lib/iris-org-store.ts");
  const save = source.slice(source.indexOf("export async function saveOrgDeskValue"), source.indexOf("export async function mutateOrgDeskValue"));
  assert.doesNotMatch(save, /for \(let attempt/);
  assert.match(save, /throw new Error\(CONCURRENT_UPDATE\)/);
});

test("las escrituras de memoria usan mutateOrgDeskValue", () => {
  const evals = read("app/api/iris-evals/route.ts");
  const mission = read("app/api/iris-mission/route.ts");
  assert.doesNotMatch(evals, /saveOrgDeskValue/);
  assert.equal((evals.match(/mutateOrgDeskValue\(\{\s*kind: "memory"/g) || []).length, 2);
  assert.match(mission, /mutateOrgDeskValue\(\{\s*kind: "memory"/);
  for (const path of ["app/api/iris-evals/route.ts", "app/api/iris-mission/route.ts", "app/api/iris-creator/route.ts"]) {
    assert.match(read(path), /if \(isConcurrencyError\(error\)\) return Response\.json\(concurrencyErrorBody\(language\), \{ status: 409 \}\);/, path);
  }
});

test("muchas lecciones pendientes no hacen crecer la memoria sin límite", () => {
  let store = emptyMemoryStore();
  for (let i = 0; i < 400; i += 1) store = appendMemory(store, lesson(`P${i}`));
  assert.equal(store.records.length, 200);
  assert.equal(store.records[0].id, "P399");
});
