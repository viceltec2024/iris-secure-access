import assert from "node:assert/strict";
import test from "node:test";
import { bumpGasLimit, deploymentFromReceipt, receiptSucceeded, tokenDeployMessage } from "../lib/iris-token-deploy.ts";

test("accepts Base receipts with hex or numeric success", () => {
  assert.equal(receiptSucceeded("0x1"), true);
  assert.equal(receiptSucceeded(1), true);
  assert.equal(receiptSucceeded("0x0"), false);
  assert.deepEqual(deploymentFromReceipt(null), { pending: true });
  assert.deepEqual(deploymentFromReceipt({ status: "0x1" }), { pending: true });
  assert.deepEqual(deploymentFromReceipt({ status: "0x0", contractAddress: "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1" }), { failed: true });
  assert.deepEqual(deploymentFromReceipt({ status: 1, contractAddress: "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1" }), { address: "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1" });
});

test("token deploy errors tell the user what to do", () => {
  assert.match(tokenDeployMessage({ code: 4001, message: "rejected" }, "es"), /Cancelaste/);
  assert.match(tokenDeployMessage(new Error("NO_METAMASK"), "es"), /MetaMask/);
  assert.match(tokenDeployMessage(new Error("insufficient funds for gas"), "es"), /ETH/);
  assert.doesNotMatch(tokenDeployMessage(new Error("NO_METAMASK"), "en"), /No address was saved/);
});

test("gas limit gets a 20 percent buffer", () => {
  assert.equal(bumpGasLimit("0x64"), "0x78");
});
