import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser } from "../../../lib/authz";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function formatEther(value: string) {
  try {
    const wei = value.startsWith("0x") ? BigInt(value) : BigInt(value || "0");
    const whole = wei / 10n ** 18n;
    const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch { return "0"; }
}

export async function GET(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const address = new URL(request.url).searchParams.get("address") || "";
  if (!ADDRESS_PATTERN.test(address)) return Response.json({ error: "Invalid wallet address" }, { status: 400 });

  const rpcResponse = await fetch("https://mainnet.base.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] },
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
    ]),
  });
  const rpcData = rpcResponse.ok ? await rpcResponse.json() as { id: number; result?: string }[] : [];
  const balanceHex = rpcData.find(item => item.id === 1)?.result || "0x0";
  const blockHex = rpcData.find(item => item.id === 2)?.result || "0x0";

  let transactions: { hash: string; from: string; to: string; value: string; timestamp: string; blockNumber: number; status: string; method: string }[] = [];
  try {
    const explorerResponse = await fetch(`https://base.blockscout.com/api/v2/addresses/${address}/transactions`, { headers: { Accept: "application/json" } });
    if (explorerResponse.ok) {
      const explorer = await explorerResponse.json() as { items?: Array<{ hash?: string; from?: { hash?: string } | string; to?: { hash?: string } | string | null; value?: string; timestamp?: string; block_number?: number; status?: string; result?: string; method?: string }> };
      transactions = (explorer.items || []).slice(0, 12).map(item => ({
        hash: item.hash || "",
        from: typeof item.from === "string" ? item.from : item.from?.hash || "",
        to: typeof item.to === "string" ? item.to : item.to?.hash || "",
        value: formatEther(item.value || "0"),
        timestamp: item.timestamp || "",
        blockNumber: item.block_number || 0,
        status: item.status || item.result || "unknown",
        method: item.method || "transfer",
      })).filter(item => item.hash);
    }
  } catch { transactions = []; }

  return Response.json({
    address,
    balance: formatEther(balanceHex),
    blockNumber: Number(BigInt(blockHex)),
    transactions,
    updatedAt: new Date().toISOString(),
    explorerUrl: `https://basescan.org/address/${address}`,
  }, { headers: { "Cache-Control": "private, max-age=8" } });
}
