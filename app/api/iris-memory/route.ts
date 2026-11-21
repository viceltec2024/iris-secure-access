import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import { emptyMemoryStore, parseMemoryStore } from "../../../lib/iris-memory";
import {
  deleteMemoryRecord,
  exportMemory,
  grantMemoryConsent,
  listMemory,
  MEMORY_CATEGORIES,
  revokeMemoryConsent,
  type MemoryDataCategory,
} from "../../../lib/iris-memory-consent";
import { loadOrgDeskValue, saveOrgDeskValue } from "../../../lib/iris-org-store";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { requireOrgContext } from "../../../lib/iris-tenant";

export const dynamic = "force-dynamic";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

/**
 * Etapa 3 — API de memoria con permiso. Sesión activa obligatoria; las
 * escrituras (consentir, revocar, borrar) exigen contexto de org con
 * mutación y quedan en auditoría. Listar y exportar solo devuelven
 * registros con consentimiento vigente y no borrados (ver
 * lib/iris-memory-consent.ts); la ruta Ask existente no se toca aquí.
 */
export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await requireOrgContext(user.email);
  const loaded = await loadOrgDeskValue({ kind: "memory", organizationId: ctx.organization.id, email: user.email });
  const store = loaded.value ? parseMemoryStore(loaded.value) : emptyMemoryStore();
  return Response.json({
    organizationId: ctx.organization.id,
    revision: store.revision || 0,
    records: listMemory(store),
    deletedCount: (store.deletions || []).length,
    consents: MEMORY_CATEGORIES.map(category => ({
      category,
      latest: (store.consents || []).filter(entry => entry.category === category).at(-1) || null,
    })),
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await enforceRateLimit(`iris-memory:${user.email}`, 30, 60 * 1000))) {
    await logAudit(user.email, "IRIS_MEMORY", "memory", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiadas operaciones. Espera un momento." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    category?: string;
    recordId?: string;
    expiresAt?: string;
    expectedRevision?: unknown;
  };
  const language = "es";
  const ctx = await requireOrgContext(user.email, { mutate: true });
  const loaded = await loadOrgDeskValue({ kind: "memory", organizationId: ctx.organization.id, email: user.email });
  const store = loaded.value ? parseMemoryStore(loaded.value) : emptyMemoryStore();
  const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : undefined;

  async function persist(next: typeof store) {
    await saveOrgDeskValue({
      kind: "memory",
      organizationId: ctx.organization.id,
      email: user.email,
      expectedUpdatedAt: loaded.updatedAt,
      value: JSON.stringify(next),
    });
  }

  try {
    if (body.action === "grant" || body.action === "revoke") {
      const category = body.category as MemoryDataCategory;
      if (!MEMORY_CATEGORIES.includes(category)) {
        return Response.json({ error: "Categoría de memoria desconocida." }, { status: 400 });
      }
      const next = body.action === "grant"
        ? grantMemoryConsent(store, category, user.email, new Date().toISOString(), typeof body.expiresAt === "string" ? body.expiresAt : undefined, expectedRevision)
        : revokeMemoryConsent(store, category, user.email, new Date().toISOString(), expectedRevision);
      await persist(next);
      await logAudit(user.email, "IRIS_MEMORY", "memory", "SUCCESS", { action: body.action, category });
      return Response.json({ ok: true, revision: next.revision, records: listMemory(next) });
    }

    if (body.action === "delete") {
      const recordId = typeof body.recordId === "string" ? body.recordId : "";
      if (!recordId) return Response.json({ error: "Falta el id del registro." }, { status: 400 });
      const { store: next, tombstone } = deleteMemoryRecord(store, recordId, user.email, new Date().toISOString(), expectedRevision);
      await persist(next);
      await logAudit(user.email, "IRIS_MEMORY", "memory", "SUCCESS", { action: "delete", recordId });
      return Response.json({ ok: true, revision: next.revision, deleted: tombstone, records: listMemory(next) });
    }

    if (body.action === "export") {
      await logAudit(user.email, "IRIS_MEMORY", "memory", "SUCCESS", { action: "export" });
      return Response.json(exportMemory(store));
    }

    return Response.json({ error: language === "es" ? "Acción desconocida." : "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    if (message === "revision_conflict") {
      return Response.json({ error: "La memoria cambió mientras tanto. Recarga y reintenta." }, { status: 409 });
    }
    if (message === "Memory record not found") {
      return Response.json({ error: "Registro de memoria no encontrado." }, { status: 404 });
    }
    if (message === "verified_human_actor_required" || message === "unknown_memory_category" || message === "invalid_expires_at") {
      return Response.json({ error: "Solicitud inválida." }, { status: 400 });
    }
    return Response.json({ error: "No se pudo completar la operación." }, { status: 500 });
  }
}
