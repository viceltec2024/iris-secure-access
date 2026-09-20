const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function isEvmAddress(value: string) {
  return EVM_ADDRESS.test(value.trim());
}

function normalizeEvmAddress(value: string) {
  return value.trim();
}

export const PURCHASE_SOURCES = ["metamask", "robinhood"] as const;
export type PurchaseSource = (typeof PURCHASE_SOURCES)[number];

export const PURCHASE_CADENCES = ["once", "daily", "weekly"] as const;
export type PurchaseCadence = (typeof PURCHASE_CADENCES)[number];

export const PURCHASE_ASSETS = {
  ETH: { symbol: "ETH", name: "Ether", robinhoodSymbol: "ETH", token: "", sources: ["metamask", "robinhood"] },
  BTC: { symbol: "BTC", name: "Bitcoin", robinhoodSymbol: "BTC", token: "", sources: ["robinhood"] },
  SOL: { symbol: "SOL", name: "Solana", robinhoodSymbol: "SOL", token: "", sources: ["robinhood"] },
  USDC: { symbol: "USDC", name: "USD Coin", robinhoodSymbol: "USDC", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", sources: ["metamask", "robinhood"] },
  IRIS: { symbol: "IRIS", name: "IRIS Token", robinhoodSymbol: "", token: "", sources: ["metamask"] },
} as const;

export type PurchaseAsset = keyof typeof PURCHASE_ASSETS;

export type PurchasePlanStatus = "active" | "paused" | "completed" | "cancelled";
export type PurchaseProposalStatus = "awaiting_approval" | "approved" | "opened" | "rejected";

export type PurchasePlan = {
  id: string;
  asset: PurchaseAsset;
  amountUsd: number;
  source: PurchaseSource;
  cadence: PurchaseCadence;
  destinationWallet: string;
  status: PurchasePlanStatus;
  createdAt: string;
  lastProposedAt?: string;
  lastApprovedAt?: string;
};

export type PurchaseProposal = {
  id: string;
  planId: string;
  asset: PurchaseAsset;
  amountUsd: number;
  source: PurchaseSource;
  destinationWallet: string;
  checkoutUrl: string;
  status: PurchaseProposalStatus;
  createdAt: string;
  approvedAt?: string;
};

export type PurchaseDeskState = {
  plans: PurchasePlan[];
  proposals: PurchaseProposal[];
};

export const ROBINHOOD_CRYPTO_ORIGIN = "https://robinhood.com";
export const ROBINHOOD_WALLET_URL = "https://wallet.robinhood.com/";
export const ROBINHOOD_CONNECT_URL = "https://robinhood.com/us/en/on-ramp/";
export const METAMASK_BUY_ORIGIN = "https://portfolio.metamask.io";
export const UNISWAP_ORIGIN = "https://app.uniswap.org";
export const BASE_USDC = PURCHASE_ASSETS.USDC.token;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PLANS = 20;
const MAX_PROPOSALS = 40;

export function isPurchaseSource(value: string): value is PurchaseSource {
  return (PURCHASE_SOURCES as readonly string[]).includes(value);
}

export function isPurchaseCadence(value: string): value is PurchaseCadence {
  return (PURCHASE_CADENCES as readonly string[]).includes(value);
}

export function isPurchaseAsset(value: string): value is PurchaseAsset {
  return Object.prototype.hasOwnProperty.call(PURCHASE_ASSETS, value);
}

export function parseAmountUsd(value: unknown) {
  const amount = typeof value === "number" ? value : Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(amount) || amount < 1 || amount > 25_000) return null;
  return Math.round(amount * 100) / 100;
}

export function emptyPurchaseDesk(): PurchaseDeskState {
  return { plans: [], proposals: [] };
}

export function parsePurchaseDesk(value: string): PurchaseDeskState {
  try {
    const parsed = JSON.parse(value) as Partial<PurchaseDeskState>;
    return {
      plans: Array.isArray(parsed.plans) ? parsed.plans.filter(isStoredPlan) : [],
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals.filter(isStoredProposal) : [],
    };
  } catch {
    return emptyPurchaseDesk();
  }
}

function isStoredPlan(value: unknown): value is PurchasePlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as PurchasePlan;
  return Boolean(
    plan.id
    && isPurchaseAsset(plan.asset)
    && isPurchaseSource(plan.source)
    && isPurchaseCadence(plan.cadence)
    && Number.isFinite(plan.amountUsd)
  );
}

function isStoredProposal(value: unknown): value is PurchaseProposal {
  if (!value || typeof value !== "object") return false;
  const proposal = value as PurchaseProposal;
  return Boolean(proposal.id && isPurchaseAsset(proposal.asset) && isOfficialCheckoutUrl(proposal.checkoutUrl));
}

export function isOfficialCheckoutUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return parsed.origin === ROBINHOOD_CRYPTO_ORIGIN
      || parsed.origin === METAMASK_BUY_ORIGIN
      || parsed.origin === UNISWAP_ORIGIN;
  } catch {
    return false;
  }
}

export function assetAllowsSource(asset: PurchaseAsset, source: PurchaseSource) {
  return (PURCHASE_ASSETS[asset].sources as readonly string[]).includes(source);
}

export function buildPurchaseCheckout(input: {
  source: PurchaseSource;
  asset: PurchaseAsset;
  amountUsd: number;
  irisToken?: string;
}) {
  if (!assetAllowsSource(input.asset, input.source)) {
    throw new Error("This asset cannot be bought with that wallet.");
  }
  const amount = parseAmountUsd(input.amountUsd);
  if (amount == null) throw new Error("Invalid purchase amount.");

  if (input.source === "robinhood") {
    const symbol = PURCHASE_ASSETS[input.asset].robinhoodSymbol;
    if (!symbol) throw new Error("Robinhood does not list this asset.");
    return `${ROBINHOOD_CRYPTO_ORIGIN}/crypto/${symbol}`;
  }

  if (input.asset === "ETH") {
    return `${METAMASK_BUY_ORIGIN}/buy?chainId=8453`;
  }

  const token = input.asset === "IRIS"
    ? (input.irisToken && isEvmAddress(input.irisToken) ? normalizeEvmAddress(input.irisToken) : "")
    : PURCHASE_ASSETS[input.asset].token;
  if (!token) throw new Error("IRIS Token is not deployed yet.");
  return `${UNISWAP_ORIGIN}/swap?chain=base&inputCurrency=ETH&outputCurrency=${token}&exactAmount=${amount}`;
}

export function cadenceMs(cadence: PurchaseCadence) {
  if (cadence === "daily") return DAY_MS;
  if (cadence === "weekly") return 7 * DAY_MS;
  return 0;
}

export function isPlanDue(plan: PurchasePlan, now = Date.now()) {
  if (plan.status !== "active") return false;
  if (!plan.lastProposedAt) return true;
  if (plan.cadence === "once") return false;
  const last = Date.parse(plan.lastProposedAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= cadenceMs(plan.cadence);
}

export function createPurchasePlan(input: {
  id: string;
  asset: string;
  amountUsd: unknown;
  source: string;
  cadence: string;
  destinationWallet?: string;
  now?: string;
}): PurchasePlan {
  if (!isPurchaseAsset(input.asset)) throw new Error("Unsupported asset.");
  if (!isPurchaseSource(input.source)) throw new Error("Unsupported wallet source.");
  if (!isPurchaseCadence(input.cadence)) throw new Error("Unsupported cadence.");
  if (!assetAllowsSource(input.asset, input.source)) throw new Error("This asset cannot be bought with that wallet.");
  const amountUsd = parseAmountUsd(input.amountUsd);
  if (amountUsd == null) throw new Error("Enter an amount between $1 and $25,000.");
  const destinationWallet = input.destinationWallet && isEvmAddress(input.destinationWallet)
    ? normalizeEvmAddress(input.destinationWallet)
    : "";
  return {
    id: input.id,
    asset: input.asset,
    amountUsd,
    source: input.source,
    cadence: input.cadence,
    destinationWallet,
    status: "active",
    createdAt: input.now || new Date().toISOString(),
  };
}

export function createPurchaseProposal(plan: PurchasePlan, checkoutUrl: string, now = new Date().toISOString()): PurchaseProposal {
  if (!isOfficialCheckoutUrl(checkoutUrl)) throw new Error("Checkout URL is not an official provider.");
  return {
    id: crypto.randomUUID(),
    planId: plan.id,
    asset: plan.asset,
    amountUsd: plan.amountUsd,
    source: plan.source,
    destinationWallet: plan.destinationWallet,
    checkoutUrl,
    status: "awaiting_approval",
    createdAt: now,
  };
}

export function materializeDueProposals(state: PurchaseDeskState, irisToken = "", now = new Date()) {
  const stamp = now.toISOString();
  const next: PurchaseDeskState = {
    plans: state.plans.slice(0, MAX_PLANS),
    proposals: state.proposals.slice(-MAX_PROPOSALS),
  };
  for (const plan of next.plans) {
    if (!isPlanDue(plan, now.getTime())) continue;
    const pending = next.proposals.some(item => item.planId === plan.id && item.status === "awaiting_approval");
    if (pending) continue;
    const checkoutUrl = buildPurchaseCheckout({
      source: plan.source,
      asset: plan.asset,
      amountUsd: plan.amountUsd,
      irisToken,
    });
    next.proposals.push(createPurchaseProposal(plan, checkoutUrl, stamp));
    plan.lastProposedAt = stamp;
  }
  if (next.proposals.length > MAX_PROPOSALS) next.proposals = next.proposals.slice(-MAX_PROPOSALS);
  return next;
}

export function approveProposal(state: PurchaseDeskState, proposalId: string, now = new Date().toISOString()) {
  const proposal = state.proposals.find(item => item.id === proposalId);
  if (!proposal || proposal.status !== "awaiting_approval") throw new Error("There is no purchase waiting for approval.");
  proposal.status = "approved";
  proposal.approvedAt = now;
  const plan = state.plans.find(item => item.id === proposal.planId);
  if (plan) {
    plan.lastApprovedAt = now;
    if (plan.cadence === "once") plan.status = "completed";
  }
  return { state, proposal };
}

export function rejectProposal(state: PurchaseDeskState, proposalId: string) {
  const proposal = state.proposals.find(item => item.id === proposalId);
  if (!proposal || proposal.status !== "awaiting_approval") throw new Error("There is no purchase waiting for approval.");
  proposal.status = "rejected";
  return state;
}

export function markProposalOpened(state: PurchaseDeskState, proposalId: string) {
  const proposal = state.proposals.find(item => item.id === proposalId);
  if (!proposal || (proposal.status !== "approved" && proposal.status !== "opened")) {
    throw new Error("Approve the purchase before opening the official checkout.");
  }
  proposal.status = "opened";
  return { state, proposal };
}
