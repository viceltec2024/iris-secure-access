import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser } from "../../../lib/authz";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { devAuthEnabled } from "../../dev-auth";
import { BASE_MAINNET_CHAIN_ID, isEvmAddress, isWalletProvider, normalizeEvmAddress, parseWalletSessionValue, serializeWalletSessionValue } from "../../../lib/iris-chain";
import { requireOrgContext } from "../../../lib/iris-tenant";
import { scopedReadKeys, scopedWriteKey } from "../../../lib/iris-org-scope";

export const dynamic = "force-dynamic";

// Claves con alcance por org: lib/iris-org-scope.ts (org primero, legada después).
const DEFAULT_LOCAL_WALLET = (process.env.IRIS_DEV_WALLET || "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1").trim();

async function currentUser() {
  const identity = await getChatGPTUser();
  if (!identity) return null;
  return provisionIrisUser(identity);
}

// Contexto de org opcional: sin contexto se conserva la clave por email.
async function orgIdFor(email: string): Promise<string | null> {
  try { return (await requireOrgContext(email)).organization.id; } catch { return null; }
}

function sessionPayload(address: string, mode: "watch" | "metamask" | "robinhood") {
  return { connected: true, mode, provider: mode, address, chainId: BASE_MAINNET_CHAIN_ID };
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await orgIdFor(user.email);
  let stored = null;
  for (const key of scopedReadKeys({ organizationId: orgId, email: user.email, base: "wallet" })) {
    const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    if (row) { stored = parseWalletSessionValue(row.value); break; }
  }
  if (stored) return Response.json(sessionPayload(stored.address, stored.mode));

  if (devAuthEnabled() && isEvmAddress(DEFAULT_LOCAL_WALLET)) {
    const now = new Date().toISOString();
    const value = serializeWalletSessionValue(DEFAULT_LOCAL_WALLET, "watch");
    const key = scopedWriteKey({ organizationId: orgId, email: user.email, base: "wallet" });
    await getDb().insert(appSettings).values({ key, value, updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy: user.email, updatedAt: now },
    });
    return Response.json(sessionPayload(DEFAULT_LOCAL_WALLET, "watch"));
  }
  return Response.json({ connected: false, mode: "watch", provider: "watch", address: "", chainId: "" });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { action?: string; address?: string; mode?: string };
  const orgId = await orgIdFor(user.email);
  const key = scopedWriteKey({ organizationId: orgId, email: user.email, base: "wallet" });

  if (body.action === "disconnect") {
    // Borra la clave con alcance y la legada: sin esto, la lectura con
    // fallback volvería a encontrar la sesión antigua.
    for (const k of scopedReadKeys({ organizationId: orgId, email: user.email, base: "wallet" })) {
      await getDb().delete(appSettings).where(eq(appSettings.key, k));
    }
    return Response.json({ connected: false, mode: "watch", provider: "watch", address: "", chainId: "" });
  }

  if (body.action !== "connect") return Response.json({ error: "Unsupported request" }, { status: 400 });
  const address = normalizeEvmAddress(body.address || (devAuthEnabled() ? DEFAULT_LOCAL_WALLET : ""));
  if (!isEvmAddress(address)) return Response.json({ error: "Invalid wallet address" }, { status: 400 });
  const mode = isWalletProvider(body.mode || "") ? body.mode : "watch";

  const now = new Date().toISOString();
  const value = serializeWalletSessionValue(address, mode);
  await getDb().insert(appSettings).values({ key, value, updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedBy: user.email, updatedAt: now },
  });
  return Response.json(sessionPayload(address, mode));
}
