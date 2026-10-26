import { loadSettingCas, saveSettingCas } from "./iris-settings-cas.ts";
import {
  appendObsSample,
  emptyObsStore,
  obsKey,
  parseObsStore,
  summarizeObs,
  type ObsKind,
  type ObsStore,
} from "./iris-observability.ts";

export async function loadObsStore(organizationId: string) {
  const loaded = await loadSettingCas(obsKey(organizationId));
  return {
    store: loaded.value ? parseObsStore(loaded.value) : emptyObsStore(),
    updatedAt: loaded.updatedAt,
  };
}

export async function recordOrgObs(input: {
  organizationId: string;
  actorEmail: string;
  kind: ObsKind;
  value: number;
  label?: string;
  now?: string;
}) {
  const key = obsKey(input.organizationId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await loadSettingCas(key);
    const store = loaded.value ? parseObsStore(loaded.value) : emptyObsStore();
    const next = appendObsSample(store, {
      kind: input.kind,
      value: input.value,
      label: input.label?.slice(0, 80),
      at: input.now || new Date().toISOString(),
    });
    const saved = await saveSettingCas({
      key,
      value: JSON.stringify(next),
      actorEmail: input.actorEmail,
      expectedUpdatedAt: loaded.updatedAt,
    });
    if (saved.ok) return next;
  }
  return null;
}

export async function readOrgObsSummary(organizationId: string) {
  const { store } = await loadObsStore(organizationId);
  return { store, summary: summarizeObs(store) };
}

export type { ObsStore };
