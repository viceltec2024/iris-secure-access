import { asc, desc, eq, isNull } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { irisChainBlocks, irisChainTransactions } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";

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
    await db.transaction(async tx => {
      await tx.insert(irisChainBlocks).values({ height, hash, previousHash, merkleRoot, transactionCount: pending.length, validator, createdAt });
      for (const transaction of pending) await tx.update(irisChainTransactions).set({ blockHeight: height, status: "CONFIRMED" }).where(eq(irisChainTransactions.id, transaction.id));
    });
    await logAudit(user.email, "IRIS_CHAIN_BLOCK_SEALED", String(height), "SUCCESS", { hash, transactionCount: pending.length });
    return Response.json({ block: { height, hash, previousHash, merkleRoot, transactionCount: pending.length, validator, createdAt } }, { status: 201 });
  }
  return Response.json({ error: "Unsupported action" }, { status: 400 });
}
