// Bucle compare-and-swap sin dependencias (se prueba con un almacén falso).
//
// Antes, saveOrgDeskValue reintentaba un conflicto releyendo solo
// `updatedAt` y volviendo a escribir el MISMO valor: eso pisaba la escritura
// concurrente (p. ej. una aprobación humana de una lección se perdía si a la
// vez se añadía un resultado de misión). Aquí cada reintento vuelve a leer el
// valor y vuelve a aplicar la mutación sobre él.

export type CasSnapshot = { value: string; updatedAt: string | null };
export type CasSave = (value: string, expectedUpdatedAt: string | null) => Promise<boolean>;

export const CONCURRENT_UPDATE = "concurrent_update";

export async function runCasMutation<T>(input: {
  load: () => Promise<CasSnapshot>;
  save: CasSave;
  /** Se llama con el valor recién leído en cada intento; debe ser pura. */
  mutate: (value: string) => { value: string; result: T } | { skip: true; result: T };
  attempts?: number;
}): Promise<T> {
  const attempts = Math.max(1, Math.min(input.attempts ?? 5, 8));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await input.load();
    const next = input.mutate(snapshot.value);
    if ("skip" in next) return next.result;
    if (await input.save(next.value, snapshot.updatedAt)) return next.result;
  }
  throw new Error(CONCURRENT_UPDATE);
}

/**
 * `updatedAt` es la versión del CAS. Si dos escrituras caen en el mismo
 * milisegundo, la segunda tendría el mismo sello que la primera y un tercer
 * escritor con el sello antiguo podría colarse (ABA). El nuevo sello siempre
 * es estrictamente posterior al esperado.
 */
export function nextCasTimestamp(expectedUpdatedAt: string | null, now = new Date()): string {
  if (!expectedUpdatedAt) return now.toISOString();
  const previous = Date.parse(expectedUpdatedAt);
  if (!Number.isFinite(previous) || now.getTime() > previous) return now.toISOString();
  return new Date(previous + 1).toISOString();
}

export function isConcurrencyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return message === CONCURRENT_UPDATE || message === "revision_conflict" || message === "cas_conflict";
}

export function concurrencyErrorBody(language: "es" | "en" = "es") {
  return {
    error: language === "en"
      ? "Another change was saved at the same time. Reload and try again."
      : "Otro cambio se guardó al mismo tiempo. Recarga y vuelve a intentarlo.",
    code: CONCURRENT_UPDATE,
  };
}
