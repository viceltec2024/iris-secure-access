/**
 * Load/save org-scoped desks with one-time legacy email-key migration.
 * Legacy data migrates into the first organization that loads it; later orgs start empty.
 */

import { loadSettingCas, saveSettingCas } from "./iris-settings-cas.ts";
import { legacyEmailDeskKey, orgDeskKey } from "./iris-tenant-core.ts";
import { CONCURRENT_UPDATE, runCasMutation } from "./iris-cas-core.ts";

function legacyMigratedFlag(kind: "creator" | "mission" | "memory", email: string) {
  return `iris_legacy_migrated:${kind}:${email.trim().toLowerCase()}`;
}

export async function loadOrgDeskValue(input: {
  kind: "creator" | "mission" | "memory";
  organizationId: string;
  email: string;
}) {
  const orgKey = orgDeskKey(input.kind, input.organizationId);
  const loaded = await loadSettingCas(orgKey);
  if (loaded.value) return { key: orgKey, ...loaded };

  const migrateFlag = legacyMigratedFlag(input.kind, input.email);
  const flag = await loadSettingCas(migrateFlag);
  if (flag.value && flag.value !== input.organizationId) {
    // Legacy already claimed by another org — keep this tenant empty.
    return { key: orgKey, value: "", updatedAt: null as string | null, updatedBy: null as string | null };
  }

  const legacyKey = legacyEmailDeskKey(input.kind, input.email);
  const legacy = await loadSettingCas(legacyKey);
  if (legacy.value) {
    await saveSettingCas({
      key: orgKey,
      value: legacy.value,
      actorEmail: input.email,
      expectedUpdatedAt: null,
    });
    await saveSettingCas({
      key: migrateFlag,
      value: input.organizationId,
      actorEmail: input.email,
      expectedUpdatedAt: flag.updatedAt,
    });
    const again = await loadSettingCas(orgKey);
    return { key: orgKey, ...again };
  }
  return { key: orgKey, value: "", updatedAt: null as string | null, updatedBy: null as string | null };
}

/**
 * Guarda solo si nadie escribió desde la lectura (`expectedUpdatedAt`).
 * Ante un conflicto lanza `concurrent_update`: antes reintentaba con el mismo
 * valor y pisaba la escritura concurrente. Para añadir o cambiar algo sobre
 * el valor más reciente, usa mutateOrgDeskValue.
 */
export async function saveOrgDeskValue(input: {
  kind: "creator" | "mission" | "memory";
  organizationId: string;
  email: string;
  expectedUpdatedAt: string | null;
  value: string;
}) {
  const key = orgDeskKey(input.kind, input.organizationId);
  const saved = await saveSettingCas({
    key,
    value: input.value,
    actorEmail: input.email,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
  if (saved.ok) return saved;
  throw new Error(CONCURRENT_UPDATE);
}

/**
 * Lee, aplica `mutate` y guarda; si otro escritor ganó, vuelve a leer y a
 * aplicar `mutate` sobre el valor nuevo (hasta 5 intentos).
 */
export async function mutateOrgDeskValue<T>(input: {
  kind: "creator" | "mission" | "memory";
  organizationId: string;
  email: string;
  mutate: (value: string) => { value: string; result: T } | { skip: true; result: T };
}): Promise<T> {
  const key = orgDeskKey(input.kind, input.organizationId);
  return runCasMutation({
    load: () => loadOrgDeskValue(input),
    save: async (value, expectedUpdatedAt) => (await saveSettingCas({ key, value, actorEmail: input.email, expectedUpdatedAt })).ok,
    mutate: input.mutate,
  });
}
