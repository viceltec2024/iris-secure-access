import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser } from "../../../lib/authz";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { devAuthEnabled } from "../../dev-auth";
import { BASE_MAINNET_CHAIN_ID, isEvmAddress, isWalletProvider, normalizeEvmAddress, parseWalletSessionValue, serializeWalletSessionValue } from "../../../lib/iris-chain";

export const dynamic = "force-dynamic";

const WALLET_KEY = "iris_local_wallet_session";
const DEFAULT_LOCAL_WALLET = (process.env.IRIS_DEV_WALLET || "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1").trim();

async function currentUser() {
  const identity = await getChatGPTUser();
  if (!identity) return null;
  return provisionIrisUser(identity);
}

function sessionPayload(address: string, mode: "watch" | "metamask" | "robinhood") {
  return { connected: true, mode, provider: mode, address, chainId: BASE_MAINNET_CHAIN_ID };
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const key = `${WALLET_KEY}:${user.email}`;
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const stored = row ? parseWalletSessionValue(row.value) : null;
  if (stored) return Response.json(sessionPayload(stored.address, stored.mode));

  if (devAuthEnabled() && isEvmAddress(DEFAULT_LOCAL_WALLET)) {
    const now = new Date().toISOString();
    const value = serializeWalletSessionValue(DEFAULT_LOCAL_WALLET, "watch");
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
  const key = `${WALLET_KEY}:${user.email}`;

  if (body.action === "disconnect") {
    await getDb().delete(appSettings).where(eq(appSettings.key, key));
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
