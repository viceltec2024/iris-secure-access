import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import {
  approveProposal,
  buildPurchaseCheckout,
  createPurchasePlan,
  createPurchaseProposal,
  emptyPurchaseDesk,
  markProposalOpened,
  materializeDueProposals,
  parsePurchaseDesk,
  rejectProposal,
  type PurchaseDeskState,
} from "../../../lib/iris-purchases";

export const dynamic = "force-dynamic";

const DESK_KEY = "iris_purchase_desk";
const TOKEN_KEY = "iris_token_base_mainnet_contract";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

async function loadDesk(email: string) {
  const key = `${DESK_KEY}:${email}`;
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return { key, state: row ? parsePurchaseDesk(row.value) : emptyPurchaseDesk() };
}

async function saveDesk(email: string, key: string, state: PurchaseDeskState) {
  const now = new Date().toISOString();
  await getDb().insert(appSettings).values({ key, value: JSON.stringify(state), updatedBy: email, updatedAt: now }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: JSON.stringify(state), updatedBy: email, updatedAt: now },
  });
}

async function irisTokenAddress() {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, TOKEN_KEY)).limit(1);
  return row?.value || "";
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { key, state } = await loadDesk(user.email);
  const next = materializeDueProposals(state, await irisTokenAddress());
  if (JSON.stringify(next) !== JSON.stringify(state)) await saveDesk(user.email, key, next);
  return Response.json(next);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    asset?: string;
    amountUsd?: unknown;
    source?: string;
    cadence?: string;
    destinationWallet?: string;
    planId?: string;
    proposalId?: string;
    status?: string;
  };

  const { key, state } = await loadDesk(user.email);
  const irisToken = await irisTokenAddress();

  try {
    if (body.action === "create_plan") {
      const plan = createPurchasePlan({
        id: crypto.randomUUID(),
        asset: String(body.asset || ""),
        amountUsd: body.amountUsd,
        source: String(body.source || ""),
        cadence: String(body.cadence || "once"),
        destinationWallet: body.destinationWallet,
      });
      state.plans.unshift(plan);
      const next = materializeDueProposals(state, irisToken);
      await saveDesk(user.email, key, next);
      await logAudit(user.email, "IRIS_PURCHASE_PLAN_CREATED", plan.id, "SUCCESS", { asset: plan.asset, source: plan.source, cadence: plan.cadence, amountUsd: plan.amountUsd });
      return Response.json(next, { status: 201 });
    }

    if (body.action === "set_plan") {
      const plan = state.plans.find(item => item.id === body.planId);
      if (!plan) return Response.json({ error: "Purchase plan not found" }, { status: 404 });
      if (body.status === "paused" || body.status === "cancelled" || body.status === "active") plan.status = body.status;
      await saveDesk(user.email, key, state);
      return Response.json(state);
    }

    if (body.action === "propose_now") {
      const plan = state.plans.find(item => item.id === body.planId && item.status === "active");
      if (!plan) return Response.json({ error: "Active purchase plan not found" }, { status: 404 });
      const pending = state.proposals.some(item => item.planId === plan.id && item.status === "awaiting_approval");
      if (!pending) {
        const checkoutUrl = buildPurchaseCheckout({ source: plan.source, asset: plan.asset, amountUsd: plan.amountUsd, irisToken });
        state.proposals.push(createPurchaseProposal(plan, checkoutUrl));
        plan.lastProposedAt = new Date().toISOString();
        await saveDesk(user.email, key, state);
      }
      return Response.json(state);
    }

    if (body.action === "approve") {
      const result = approveProposal(state, String(body.proposalId || ""));
      await saveDesk(user.email, key, result.state);
      await logAudit(user.email, "IRIS_PURCHASE_APPROVED", result.proposal.id, "SUCCESS", {
        asset: result.proposal.asset,
        source: result.proposal.source,
        amountUsd: result.proposal.amountUsd,
        checkoutUrl: result.proposal.checkoutUrl,
      });
      return Response.json({ ...result.state, approved: result.proposal });
    }

    if (body.action === "reject") {
      rejectProposal(state, String(body.proposalId || ""));
      await saveDesk(user.email, key, state);
      await logAudit(user.email, "IRIS_PURCHASE_REJECTED", String(body.proposalId || ""), "SUCCESS", {});
      return Response.json(state);
    }

    if (body.action === "open") {
      const result = markProposalOpened(state, String(body.proposalId || ""));
      await saveDesk(user.email, key, result.state);
      return Response.json({ ...result.state, opened: result.proposal });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Purchase request failed" }, { status: 400 });
  }

  return Response.json({ error: "Unsupported request" }, { status: 400 });
}
