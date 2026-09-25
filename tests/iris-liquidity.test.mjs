import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_WETH,
  buildIrisLiquidityUrl,
  buildIrisSwapUrl,
  decodeAddressResult,
  decodeUintResult,
  encodeGetPoolCall,
  encodeLiquidityCall,
  isOfficialLiquidityUrl,
  liquidityMessage,
  probeUniswapV3Liquidity,
  UNISWAP_V3_FACTORY_BASE,
} from "../lib/iris-liquidity.ts";

const token = "0x999e042367274cc7886c3b1f0d4840dfa5a81b5e";
const pool = "0x1111111111111111111111111111111111111111";

test("builds official Uniswap Base liquidity and swap URLs", () => {
  assert.equal(buildIrisLiquidityUrl(token), `https://app.uniswap.org/add/ETH/${token}?chain=base`);
  assert.equal(buildIrisSwapUrl(token), `https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${token}`);
  assert.equal(isOfficialLiquidityUrl(buildIrisLiquidityUrl(token)), true);
  assert.equal(isOfficialLiquidityUrl(buildIrisSwapUrl(token)), true);
  assert.equal(isOfficialLiquidityUrl("https://evil.example/add/ETH/0xabc"), false);
  assert.equal(isOfficialLiquidityUrl("http://app.uniswap.org/add/ETH/0xabc"), false);
  assert.throws(() => buildIrisLiquidityUrl("not-a-token"));
});

test("encodes Uniswap V3 pool probes without inventing wallets", () => {
  const data = encodeGetPoolCall(token, BASE_WETH, 3000);
  assert.match(data, /^0x1698ee82/);
  assert.equal(data.length, 10 + 64 * 3);
  assert.equal(encodeLiquidityCall(), "0x1a686502");
  assert.equal(decodeAddressResult(`0x${"0".repeat(24)}${pool.slice(2)}`), pool.toLowerCase());
  assert.equal(decodeAddressResult("0x0000000000000000000000000000000000000000000000000000000000000000"), "");
  assert.equal(decodeUintResult("0x2a"), 42n);
});

test("marks liquidity ready only when a live Uniswap pool has reserves", async () => {
  const empty = await probeUniswapV3Liquidity({
    tokenAddress: token,
    feeTiers: [3000],
    rpc: async () => `0x${"0".repeat(64)}`,
  });
  assert.equal(empty.ready, false);

  const calls = [];
  const live = await probeUniswapV3Liquidity({
    tokenAddress: token,
    feeTiers: [3000],
    rpc: async (method, params) => {
      calls.push({ method, to: params[0]?.to });
      if (params[0]?.to === UNISWAP_V3_FACTORY_BASE) {
        return `0x${"0".repeat(24)}${pool.slice(2)}`;
      }
      return "0x64";
    },
  });
  assert.equal(live.ready, true);
  assert.equal(live.poolAddress, pool.toLowerCase());
  assert.equal(live.fee, 3000);
  assert.equal(live.liquidity, "100");
  assert.equal(calls[0].method, "eth_call");
});

test("liquidity copy stays actionable in Spanish and English", () => {
  assert.match(liquidityMessage("es", false), /Uniswap/);
  assert.match(liquidityMessage("es", false), /no mueve fondos/);
  assert.match(liquidityMessage("en", true), /pool exists/i);
});
