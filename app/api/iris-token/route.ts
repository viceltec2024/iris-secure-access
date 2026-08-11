import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";

const CONTRACT_KEY = "iris_token_base_mainnet_contract";
const BASE_RPC = "https://mainnet.base.org";
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (!response.ok || body.error) throw new Error(body.error?.message || "Base RPC request failed");
  return body.result;
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [setting] = await getDb().select().from(appSettings).where(eq(appSettings.key, CONTRACT_KEY)).limit(1);
  return Response.json({
    address: setting?.value || null,
    network: "Base Mainnet",
    chainId: 8453,
    name: "IRIS Token",
    symbol: "IRIS",
    decimals: 18,
    totalSupply: "1000000000",
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return Response.json({ error: "Administrator approval required" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { address?: string; transactionHash?: string };
  const address = String(body.address || "");
  const transactionHash = String(body.transactionHash || "");
  if (!ADDRESS_PATTERN.test(address) || !HASH_PATTERN.test(transactionHash)) return Response.json({ error: "Invalid deployment details" }, { status: 400 });

  const receipt = await rpc("eth_getTransactionReceipt", [transactionHash]) as { contractAddress?: string; status?: string } | null;
  if (!receipt || receipt.status !== "0x1" || receipt.contractAddress?.toLowerCase() !== address.toLowerCase()) {
    await logAudit(user.email, "IRIS_TOKEN_DEPLOYMENT_RECORDED", address, "DENIED", { transactionHash, reason: "receipt_verification_failed" });
    return Response.json({ error: "The Base deployment could not be verified" }, { status: 409 });
  }
  const code = await rpc("eth_getCode", [address, "latest"]);
  if (typeof code !== "string" || code === "0x") return Response.json({ error: "No contract code found at this address" }, { status: 409 });

  await getDb().insert(appSettings).values({ key: CONTRACT_KEY, value: address, updatedBy: user.email, updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: appSettings.key, set: { value: address, updatedBy: user.email, updatedAt: new Date().toISOString() } });
  await logAudit(user.email, "IRIS_TOKEN_DEPLOYMENT_RECORDED", address, "SUCCESS", { transactionHash, network: "Base Mainnet" });
  return Response.json({ address, transactionHash }, { status: 201 });
}
