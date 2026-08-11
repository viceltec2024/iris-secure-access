import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { provisionIrisUser } from "../../../lib/authz";

const CONTRACT_KEY = "iris_token_base_mainnet_contract";
const BASE_RPC = "https://mainnet.base.org";
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function formatToken(value: string, decimals = 18) {
  try {
    const amount = BigInt(value.startsWith("0x") ? value : value || "0");
    const divisor = 10n ** BigInt(decimals);
    const whole = amount / divisor;
    const fraction = (amount % divisor).toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch { return "0"; }
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(BASE_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (!response.ok || body.error) throw new Error(body.error?.message || "Base RPC failed");
  return body.result || "0x0";
}

export async function GET(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [setting] = await getDb().select().from(appSettings).where(eq(appSettings.key, CONTRACT_KEY)).limit(1);
  const contract = setting?.value || "";
  if (!ADDRESS_PATTERN.test(contract)) return Response.json({ error: "IRIS contract is not configured" }, { status: 404 });
  const wallet = new URL(request.url).searchParams.get("wallet") || "";
  const walletValid = ADDRESS_PATTERN.test(wallet);
  const balanceData = walletValid ? `0x70a08231000000000000000000000000${wallet.slice(2).toLowerCase()}` : "";
  const [totalSupplyHex, code, balanceHex, blockHex] = await Promise.all([
    rpc("eth_call", [{ to: contract, data: "0x18160ddd" }, "latest"]), rpc("eth_getCode", [contract, "latest"]),
    walletValid ? rpc("eth_call", [{ to: contract, data: balanceData }, "latest"]) : Promise.resolve("0x0"), rpc("eth_blockNumber", []),
  ]);
  let holders = 0;
  let verified = false;
  let transfers: Array<{ hash: string; from: string; to: string; value: string; timestamp: string; blockNumber: number }> = [];
  try {
    const [tokenResponse, transferResponse, contractResponse] = await Promise.all([
      fetch(`https://base.blockscout.com/api/v2/tokens/${contract}`), fetch(`https://base.blockscout.com/api/v2/tokens/${contract}/transfers`), fetch(`https://base.blockscout.com/api/v2/smart-contracts/${contract}`),
    ]);
    if (tokenResponse.ok) { const token = await tokenResponse.json() as { holders_count?: string | number }; holders = Number(token.holders_count || 0); }
    if (transferResponse.ok) {
      const data = await transferResponse.json() as { items?: Array<{ transaction_hash?: string; from?: { hash?: string } | string; to?: { hash?: string } | string; total?: { value?: string; decimals?: string }; timestamp?: string; block_number?: number }> };
      transfers = (data.items || []).slice(0, 8).map(item => ({ hash: item.transaction_hash || "", from: typeof item.from === "string" ? item.from : item.from?.hash || "", to: typeof item.to === "string" ? item.to : item.to?.hash || "", value: formatToken(item.total?.value || "0", Number(item.total?.decimals || 18)), timestamp: item.timestamp || "", blockNumber: item.block_number || 0 })).filter(item => item.hash);
    }
    verified = contractResponse.ok;
  } catch { /* Explorer metadata is best-effort; Base RPC remains authoritative. */ }
  return Response.json({ contract, network: "Base Mainnet", chainId: 8453, blockNumber: Number(BigInt(blockHex)), contractLive: code !== "0x", totalSupply: formatToken(totalSupplyHex), walletBalance: formatToken(balanceHex), holders, transfers, verified,
    distribution: [{ label: "Growth & rewards", percent: 40, amount: "400,000,000" }, { label: "Liquidity", percent: 20, amount: "200,000,000" }, { label: "Treasury", percent: 20, amount: "200,000,000" }, { label: "Team vesting", percent: 15, amount: "150,000,000" }, { label: "Partnerships", percent: 5, amount: "50,000,000" }],
    readiness: { contract: code !== "0x", metadata: true, treasuryMultisig: false, vesting: false, liquidity: false }, updatedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "private, max-age=8" } });
}
