import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { irisChainBlocks, irisChainTransactions } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import { requireStepUp } from "../../../lib/iris-step-up";

const encoder = new TextEncoder();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

async function ensureGenesis() {
  const db = getDb();
  const [existing] = await db.select().from(irisChainBlocks).orderBy(asc(irisChainBlocks.height)).limit(1);
  if (existing) return;
  const createdAt = "2026-01-14T00:00:00.000Z";
  const previousHash = "0".repeat(64);
  const merkleRoot = await sha256("IRIS_GENESIS");
  const hash = await sha256(JSON.stringify({ height: 0, previousHash, merkleRoot, validator: "iris-genesis", createdAt }));
  await db.insert(irisChainBlocks).values({ height: 0, hash, previousHash, merkleRoot, transactionCount: 0, validator: "iris-genesis", createdAt }).onConflictDoNothing();
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const stepUp = await requireStepUp(user.email);
  if (stepUp) return stepUp;
  await ensureGenesis();
  const db = getDb();
  const blocks = await db.select().from(irisChainBlocks).orderBy(desc(irisChainBlocks.height)).limit(12);
  const transactions = user.role === "ADMIN"
    ? await db.select().from(irisChainTransactions).orderBy(desc(irisChainTransactions.createdAt)).limit(20)
    : await db.select().from(irisChainTransactions).where(eq(irisChainTransactions.actorEmail, user.email)).orderBy(desc(irisChainTransactions.createdAt)).limit(20);
  return Response.json({ network: "IRIS Chain", consensus: "Proof of Authority", status: "ONLINE", blocks, transactions, pending: transactions.filter(item => item.status === "PENDING").length });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const stepUp = await requireStepUp(user.email);
  if (stepUp) return stepUp;
  await ensureGenesis();
  const body = await request.json().catch(() => ({})) as { action?: string; type?: string; payload?: string };
  const db = getDb();
  if (body.action === "submit") {
    const type = String(body.type || "SECURITY_ATTESTATION").trim().slice(0, 48);
    const payload = String(body.payload || "").trim().slice(0, 1000);
    if (!payload) return Response.json({ error: "Payload is required" }, { status: 400 });
    const id = crypto.randomUUID();
    const payloadHash = await sha256(JSON.stringify({ id, type, payload, actor: user.email }));
    const [transaction] = await db.insert(irisChainTransactions).values({ id, actorEmail: user.email, type, payload, payloadHash }).returning();
    await logAudit(user.email, "IRIS_CHAIN_TRANSACTION_SUBMITTED", id, "SUCCESS", { type, payloadHash });
    return Response.json({ transaction }, { status: 201 });
  }
  if (body.action === "seal") {
    if (user.role !== "ADMIN") return Response.json({ error: "Administrator approval required" }, { status: 403 });
    const pending = await db.select().from(irisChainTransactions).where(isNull(irisChainTransactions.blockHeight)).orderBy(asc(irisChainTransactions.createdAt)).limit(100);
    if (!pending.length) return Response.json({ error: "No pending transactions" }, { status: 409 });
    const [latest] = await db.select().from(irisChainBlocks).orderBy(desc(irisChainBlocks.height)).limit(1);
    const height = (latest?.height ?? -1) + 1;
    const merkleRoot = await sha256(pending.map(item => item.payloadHash).join("|"));
    const createdAt = new Date().toISOString();
    const validator = user.email;
    const previousHash = latest?.hash || "0".repeat(64);
    const hash = await sha256(JSON.stringify({ height, previousHash, merkleRoot, validator, createdAt }));
    // D1 no admite transacciones interactivas (db.transaction falla en
    // producción). db.batch ejecuta las sentencias de forma atómica y revierte
    // todo si una falla. Primero se confirman las transacciones pendientes
    // (solo las que siguen sin bloque) y al final se inserta el bloque solo si
    // se confirmaron TODAS y el bloque anterior sigue siendo height - 1. Si
    // otro sellado se cruzó, el hash queda NULL, falla la restricción NOT NULL
    // y se revierte el lote: nunca se guarda un bloque vacío ni desalineado.
    const confirmations = pending.map(transaction => db.update(irisChainTransactions)
      .set({ blockHeight: height, status: "CONFIRMED" })
      .where(and(eq(irisChainTransactions.id, transaction.id), isNull(irisChainTransactions.blockHeight))));
    // Insert normal de Drizzle (no db.run con SQL crudo: el batch de D1 de
    // Drizzle no puede enlazar parámetros de SQLiteRaw) con el hash condicional.
    const sealBlock = db.insert(irisChainBlocks).values({
      height,
      hash: sql`CASE
        WHEN (SELECT COUNT(*) FROM iris_chain_transactions WHERE block_height = ${height}) = ${pending.length}
         AND COALESCE((SELECT MAX(height) FROM iris_chain_blocks), -1) = ${height - 1}
        THEN ${hash}
        ELSE NULL
      END`,
      previousHash,
      merkleRoot,
      transactionCount: pending.length,
      validator,
      createdAt,
    });
    try {
      const [first, ...rest] = confirmations;
      await db.batch([first, ...rest, sealBlock]);
    } catch (error) {
      // Solo un choque de restricciones significa que otro sellado se cruzó;
      // cualquier otro error es un fallo real y no se disfraza de conflicto.
      const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
      if (/NOT NULL|UNIQUE|PRIMARY KEY|constraint/i.test(message)) {
        return Response.json({ error: "Otro bloque se selló al mismo tiempo. Vuelve a intentarlo." }, { status: 409 });
      }
      throw error;
    }
    await logAudit(user.email, "IRIS_CHAIN_BLOCK_SEALED", String(height), "SUCCESS", { hash, transactionCount: pending.length });
    return Response.json({ block: { height, hash, previousHash, merkleRoot, transactionCount: pending.length, validator, createdAt } }, { status: 201 });
  }
  return Response.json({ error: "Unsupported action" }, { status: 400 });
}
