/**
 * Load/save org-scoped desks with one-time legacy email-key migration.
 * Legacy data migrates into the first organization that loads it; later orgs start empty.
 */

import { loadSettingCas, saveSettingCas } from "./iris-settings-cas.ts";
import { legacyEmailDeskKey, orgDeskKey } from "./iris-tenant-core.ts";

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

export async function saveOrgDeskValue(input: {
  kind: "creator" | "mission" | "memory";
  organizationId: string;
  email: string;
  expectedUpdatedAt: string | null;
  value: string;
}) {
  const key = orgDeskKey(input.kind, input.organizationId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const expected = attempt === 0 ? input.expectedUpdatedAt : (await loadSettingCas(key)).updatedAt;
    const saved = await saveSettingCas({
      key,
      value: input.value,
      actorEmail: input.email,
      expectedUpdatedAt: expected,
    });
    if (saved.ok) return saved;
  }
  throw new Error("concurrent_update");
}
