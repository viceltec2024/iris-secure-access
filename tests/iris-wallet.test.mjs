import assert from "node:assert/strict";
import test from "node:test";
import { isEvmAddress, isWalletProvider, normalizeEvmAddress, parseWalletSessionValue, serializeWalletSessionValue } from "../lib/iris-chain.ts";

test("accepts any checksum or lowercase EVM wallet", () => {
  assert.equal(isEvmAddress("0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1"), true);
  assert.equal(isEvmAddress("  0x49beaec30c7431235c3262a2b1c0c5d8b5a0d3e1  "), true);
  assert.equal(isEvmAddress("49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1"), false);
  assert.equal(isEvmAddress("0x123"), false);
  assert.equal(normalizeEvmAddress("  0xAbc  "), "0xAbc");
});

test("persists MetaMask and Robinhood wallet sessions", () => {
  const address = "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1";
  assert.equal(isWalletProvider("metamask"), true);
  assert.equal(isWalletProvider("robinhood"), true);
  assert.equal(isWalletProvider("phantom"), false);
  assert.deepEqual(parseWalletSessionValue(address), { address, mode: "watch" });
  assert.deepEqual(parseWalletSessionValue(serializeWalletSessionValue(address, "metamask")), { address, mode: "metamask" });
  assert.deepEqual(parseWalletSessionValue(serializeWalletSessionValue(address, "robinhood")), { address, mode: "robinhood" });
  assert.equal(parseWalletSessionValue("not-a-wallet"), null);
});
