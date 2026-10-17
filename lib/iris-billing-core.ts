/**
 * Pure billing mode helpers — safe for Node unit tests (no DB).
 * Real charging stays disabled until explicit owner authorization.
 */

export type BillingMode = "off" | "test" | "blocked_live";

export type BillingProvider = {
  id: "none" | "stripe";
  mode: BillingMode;
  /** Always false until production payments are expressly authorized. */
  chargeEnabled: false;
  testMode: boolean;
  note: string;
  stripeKeyPresent: boolean;
  stripeKeyKind: "none" | "test" | "live" | "unknown";
};

type EnvLike = Record<string, string | undefined>;

function readStripeKind(secret: string): BillingProvider["stripeKeyKind"] {
  if (!secret.trim()) return "none";
  if (secret.startsWith("sk_test_")) return "test";
  if (secret.startsWith("sk_live_")) return "live";
  return "unknown";
}

export function getBillingProvider(env: EnvLike = {}): BillingProvider {
  const stripeSecret = String(env.STRIPE_SECRET_KEY || "");
  const stripeKeyKind = readStripeKind(stripeSecret);
  const testFlag = env.IRIS_BILLING_TEST === "1";

  if (stripeKeyKind === "live" || env.IRIS_BILLING_LIVE === "1") {
    return {
      id: "stripe",
      mode: "blocked_live",
      chargeEnabled: false,
      testMode: false,
      stripeKeyPresent: Boolean(stripeSecret),
      stripeKeyKind,
      note: "Live Stripe / real charging is blocked until you expressly authorize production payments.",
    };
  }

  if (testFlag) {
    return {
      id: "stripe",
      mode: "test",
      chargeEnabled: false,
      testMode: true,
      stripeKeyPresent: stripeKeyKind === "test",
      stripeKeyKind,
      note: "Test billing mode: simulates checkout and plan changes locally. No real charges.",
    };
  }

  return {
    id: "none",
    mode: "off",
    chargeEnabled: false,
    testMode: false,
    stripeKeyPresent: false,
    stripeKeyKind,
    note: "Payment integration off. Set IRIS_BILLING_TEST=1 for local/test checkout simulation.",
  };
}
