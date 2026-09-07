import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser } from "../../../lib/authz";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { devAuthEnabled } from "../../dev-auth";
import { BASE_MAINNET_CHAIN_ID } from "../../../lib/iris-chain";

export const dynamic = "force-dynamic";

const WALLET_KEY = "iris_local_wallet_session";
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_LOCAL_WALLET = (process.env.IRIS_DEV_WALLET || "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1").trim();

async function currentUser() {
  const identity = await getChatGPTUser();
  if (!identity) return null;
  return provisionIrisUser(identity);
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const key = `${WALLET_KEY}:${user.email}`;
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (row && ADDRESS_PATTERN.test(row.value)) {
    return Response.json({ connected: true, mode: "local", address: row.value, chainId: BASE_MAINNET_CHAIN_ID });
  }
  if (devAuthEnabled() && ADDRESS_PATTERN.test(DEFAULT_LOCAL_WALLET)) {
    const now = new Date().toISOString();
    await getDb().insert(appSettings).values({ key, value: DEFAULT_LOCAL_WALLET, updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({
      target: appSettings.key,
      set: { value: DEFAULT_LOCAL_WALLET, updatedBy: user.email, updatedAt: now },
    });
    return Response.json({ connected: true, mode: "local", address: DEFAULT_LOCAL_WALLET, chainId: BASE_MAINNET_CHAIN_ID });
  }
  return Response.json({ connected: false, mode: "metamask", address: "", chainId: "" });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { action?: string; address?: string };
  const key = `${WALLET_KEY}:${user.email}`;

  if (body.action === "disconnect") {
    await getDb().delete(appSettings).where(eq(appSettings.key, key));
    return Response.json({ connected: false, mode: "local", address: "", chainId: "" });
  }

  if (body.action !== "connect") return Response.json({ error: "Unsupported request" }, { status: 400 });
  const address = (body.address || DEFAULT_LOCAL_WALLET).trim();
  if (!ADDRESS_PATTERN.test(address)) return Response.json({ error: "Invalid wallet address" }, { status: 400 });
  if (!devAuthEnabled() && !body.address) return Response.json({ error: "Connect MetaMask to attach a wallet." }, { status: 400 });

  const now = new Date().toISOString();
  await getDb().insert(appSettings).values({ key, value: address, updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: address, updatedBy: user.email, updatedAt: now },
  });
  return Response.json({ connected: true, mode: "local", address, chainId: BASE_MAINNET_CHAIN_ID });
}
