import assert from "node:assert/strict";
import test from "node:test";
import {
  approveProposal,
  assetAllowsSource,
  buildPurchaseCheckout,
  createPurchasePlan,
  createPurchaseProposal,
  isOfficialCheckoutUrl,
  isPlanDue,
  markProposalOpened,
  materializeDueProposals,
  parseAmountUsd,
  rejectProposal,
} from "../lib/iris-purchases.ts";

const wallet = "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1";

test("only official MetaMask and Robinhood checkout URLs are allowed", () => {
  assert.equal(buildPurchaseCheckout({ source: "robinhood", asset: "ETH", amountUsd: 25 }), "https://robinhood.com/crypto/ETH");
  assert.equal(buildPurchaseCheckout({ source: "robinhood", asset: "BTC", amountUsd: 40 }), "https://robinhood.com/crypto/BTC");
  assert.equal(buildPurchaseCheckout({ source: "metamask", asset: "ETH", amountUsd: 25 }), "https://portfolio.metamask.io/buy?chainId=8453");
  assert.match(buildPurchaseCheckout({ source: "metamask", asset: "USDC", amountUsd: 25 }), /^https:\/\/app\.uniswap\.org\/swap\?/);
  assert.equal(isOfficialCheckoutUrl("https://evil.example/steal"), false);
  assert.equal(isOfficialCheckoutUrl("http://robinhood.com/crypto/ETH"), false);
  assert.equal(assetAllowsSource("BTC", "metamask"), false);
  assert.equal(assetAllowsSource("IRIS", "robinhood"), false);
  assert.throws(() => buildPurchaseCheckout({ source: "metamask", asset: "BTC", amountUsd: 10 }));
});

test("purchase plans stay pending until the user approves", () => {
  const plan = createPurchasePlan({ id: "plan-1", asset: "ETH", amountUsd: "25", source: "robinhood", cadence: "weekly", destinationWallet: wallet });
  assert.equal(plan.status, "active");
  assert.equal(isPlanDue(plan), true);
  const desk = materializeDueProposals({ plans: [plan], proposals: [] });
  assert.equal(desk.proposals.length, 1);
  assert.equal(desk.proposals[0].status, "awaiting_approval");
  assert.equal(desk.proposals[0].checkoutUrl, "https://robinhood.com/crypto/ETH");
  assert.throws(() => markProposalOpened(desk, desk.proposals[0].id));
  const approved = approveProposal(desk, desk.proposals[0].id);
  assert.equal(approved.proposal.status, "approved");
  const opened = markProposalOpened(approved.state, approved.proposal.id);
  assert.equal(opened.proposal.status, "opened");
  assert.equal(isPlanDue(desk.plans[0]), false);
});

test("rejects a proposed buy without opening checkout", () => {
  const plan = createPurchasePlan({ id: "plan-2", asset: "ETH", amountUsd: 10, source: "metamask", cadence: "once" });
  const proposal = createPurchaseProposal(plan, buildPurchaseCheckout(plan));
  const desk = { plans: [plan], proposals: [proposal] };
  rejectProposal(desk, proposal.id);
  assert.equal(desk.proposals[0].status, "rejected");
  assert.equal(parseAmountUsd("0"), null);
  assert.equal(parseAmountUsd(25), 25);
});
