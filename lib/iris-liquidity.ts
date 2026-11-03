const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const UNISWAP_ORIGIN = "https://app.uniswap.org";
export const BASE_WETH = "0x4200000000000000000000000000000000000006";
export const UNISWAP_V3_FACTORY_BASE = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
export const UNISWAP_V3_FEE_TIERS = [500, 3000, 10000] as const;

const GET_POOL_SELECTOR = "1698ee82";
const LIQUIDITY_SELECTOR = "1a686502";

export function isEvmTokenAddress(value: string) {
  return EVM_ADDRESS.test(value.trim());
}

export function normalizeTokenAddress(value: string) {
  return value.trim();
}

export function buildIrisLiquidityUrl(tokenAddress: string) {
  if (!isEvmTokenAddress(tokenAddress)) throw new Error("IRIS Token is not deployed yet.");
  const token = normalizeTokenAddress(tokenAddress);
  return `${UNISWAP_ORIGIN}/add/ETH/${token}?chain=base`;
}

export function buildIrisSwapUrl(tokenAddress: string) {
  if (!isEvmTokenAddress(tokenAddress)) throw new Error("IRIS Token is not deployed yet.");
  const token = normalizeTokenAddress(tokenAddress);
  return `${UNISWAP_ORIGIN}/swap?chain=base&inputCurrency=ETH&outputCurrency=${token}`;
}

export function isOfficialLiquidityUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.origin !== UNISWAP_ORIGIN) return false;
    return parsed.pathname.startsWith("/add/")
      || parsed.pathname.startsWith("/positions/create")
      || parsed.pathname === "/swap"
      || parsed.pathname.startsWith("/swap/");
  } catch {
    return false;
  }
}

export function encodeGetPoolCall(tokenA: string, tokenB: string, fee: number) {
  if (!isEvmTokenAddress(tokenA) || !isEvmTokenAddress(tokenB)) throw new Error("Invalid pool tokens.");
  if (!Number.isInteger(fee) || fee < 0 || fee > 0xffffff) throw new Error("Invalid Uniswap fee tier.");
  const a = normalizeTokenAddress(tokenA).slice(2).toLowerCase().padStart(64, "0");
  const b = normalizeTokenAddress(tokenB).slice(2).toLowerCase().padStart(64, "0");
  const feeHex = fee.toString(16).padStart(64, "0");
  return `0x${GET_POOL_SELECTOR}${a}${b}${feeHex}`;
}

export function encodeLiquidityCall() {
  return `0x${LIQUIDITY_SELECTOR}`;
}

export function decodeAddressResult(result: string) {
  const hex = String(result || "").toLowerCase();
  if (!hex.startsWith("0x") || hex.length < 66) return "";
  const address = `0x${hex.slice(-40)}`;
  if (!EVM_ADDRESS.test(address) || address === ZERO_ADDRESS) return "";
  return address;
}

export function decodeUintResult(result: string) {
  try {
    const hex = String(result || "0x0");
    return BigInt(hex === "0x" ? "0x0" : hex);
  } catch {
    return 0n;
  }
}

export type LiquidityProbe = {
  ready: boolean;
  poolAddress: string;
  fee: number | null;
  liquidity: string;
};

export async function probeUniswapV3Liquidity(input: {
  tokenAddress: string;
  rpc: (method: string, params: unknown[]) => Promise<string>;
  feeTiers?: readonly number[];
}): Promise<LiquidityProbe> {
  const token = normalizeTokenAddress(input.tokenAddress);
  if (!isEvmTokenAddress(token)) {
    return { ready: false, poolAddress: "", fee: null, liquidity: "0" };
  }
  const tiers = input.feeTiers || UNISWAP_V3_FEE_TIERS;
  for (const fee of tiers) {
    const poolData = encodeGetPoolCall(token, BASE_WETH, fee);
    const poolRaw = await input.rpc("eth_call", [{ to: UNISWAP_V3_FACTORY_BASE, data: poolData }, "latest"]);
    const poolAddress = decodeAddressResult(poolRaw);
    if (!poolAddress) continue;
    const liquidityRaw = await input.rpc("eth_call", [{ to: poolAddress, data: encodeLiquidityCall() }, "latest"]);
    const liquidity = decodeUintResult(liquidityRaw);
    if (liquidity > 0n) {
      return { ready: true, poolAddress, fee, liquidity: liquidity.toString() };
    }
  }
  return { ready: false, poolAddress: "", fee: null, liquidity: "0" };
}

export function liquidityMessage(language: "es" | "en", ready: boolean) {
  const es = language === "es";
  if (ready) {
    return es
      ? "Hay un pool IRIS/ETH en Uniswap (Base). Puedes añadir más liquidez o intercambiar."
      : "An IRIS/ETH Uniswap pool exists on Base. You can add more liquidity or swap.";
  }
  return es
    ? "Todavía no hay liquidez IRIS/ETH en Uniswap. Abre Uniswap, deposita IRIS + ETH y confirma en MetaMask. IRIS no mueve fondos sola."
    : "There is no IRIS/ETH Uniswap liquidity yet. Open Uniswap, deposit IRIS + ETH, and confirm in MetaMask. IRIS never moves funds alone.";
}
