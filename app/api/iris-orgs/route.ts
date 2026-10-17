import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser, logAudit } from "../../../lib/authz";
import { confirmTestCheckout, getBillingProvider, listBillingEvents, startTestCheckout } from "../../../lib/iris-billing";
import { acceptOrgInvite, createOrgInvite, listOrgInvites, revokeOrgInvite } from "../../../lib/iris-invites";
import { createOrgApiKey, listOrgApiKeys, revokeOrgApiKey } from "../../../lib/iris-org-keys";
import { loadOrgDeskValue } from "../../../lib/iris-org-store";
import { PLAN_LIMITS, type IrisPlanId } from "../../../lib/iris-plans";
import { assertNoSecretsInPayload } from "../../../lib/iris-secret-hygiene";
import {
  ORG_COOKIE,
  addOrgMember,
  createOrganization,
  ensurePersonalOrganization,
  listMembershipsForEmail,
  listOrgMembers,
  removeOrgMember,
  requireOrgContext,
  getOrganization,
  updateOrgMemberRole,
  type OrgRole,
} from "../../../lib/iris-tenant";
import { assertOrgWithinLimits, getMonthlyUsage } from "../../../lib/iris-usage";
import { buildModelCoordinationReport } from "../../../lib/iris-model-registry";
import { enforceRateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

function providerBindings() {
  return env as unknown as {
    OPENAI_API_KEY?: string;
    ELEVENLABS_API_KEY?: string;
    MODEL_API_KEY?: string;
    MUSE_API_KEY?: string;
    AI?: unknown;
    STRIPE_SECRET_KEY?: string;
    IRIS_BILLING_TEST?: string;
    IRIS_BILLING_LIVE?: string;
  };
}

function billingEnv() {
  const bindings = providerBindings();
  return {
    STRIPE_SECRET_KEY: bindings.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY,
    IRIS_BILLING_TEST: bindings.IRIS_BILLING_TEST || process.env.IRIS_BILLING_TEST,
    IRIS_BILLING_LIVE: bindings.IRIS_BILLING_LIVE || process.env.IRIS_BILLING_LIVE,
  };
}

function providerSecretStatus(language: "es" | "en") {
  const report = buildModelCoordinationReport(providerBindings(), language);
  return {
    generatedAt: report.generatedAt,
    providers: report.coordinators.map(item => ({
      id: item.id,
      label: item.label,
      status: item.status,
      detail: item.detail,
    })),
    notes: [
      ...(report.notes || []),
      language === "es"
        ? "IRIS nunca devuelve valores de claves. Solo presencia/configuración."
        : "IRIS never returns key values. Presence/configuration only.",
    ],
  };
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  await ensurePersonalOrganization(user.email, user.displayName);
  const memberships = await listMembershipsForEmail(user.email);
  const orgs = [];
  for (const membership of memberships) {
    const organization = await getOrganization(membership.organizationId);
    if (!organization) continue;
    orgs.push({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      plan: organization.plan,
      status: organization.status,
      role: membership.role,
      budgetCentsMonthly: organization.budgetCentsMonthly,
      billingMode: organization.billingMode,
      subscriptionStatus: organization.subscriptionStatus,
    });
  }

  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  const language = url.searchParams.get("language") === "en" ? "en" : "es";
  const ctx = await requireOrgContext(user.email);
  const usage = await getMonthlyUsage(ctx.organization.id);
  const limits = PLAN_LIMITS[ctx.organization.plan as IrisPlanId] || PLAN_LIMITS.starter;
  const billing = getBillingProvider(billingEnv());
  const payload: Record<string, unknown> = {
    activeOrganizationId: ctx.organization.id,
    organizations: orgs,
    usage,
    limits,
    billing,
    role: ctx.membership.role,
  };
  if (view === "members" || view === "admin") {
    payload.members = await listOrgMembers(ctx.organization.id);
    payload.invites = await listOrgInvites(ctx.organization.id);
  }
  if (view === "admin") {
    payload.apiKeys = await listOrgApiKeys(ctx.organization.id);
    payload.billingEvents = await listBillingEvents(ctx.organization.id);
    payload.providerSecrets = providerSecretStatus(language);
  }
  assertNoSecretsInPayload(payload, "iris-orgs-get");
  return Response.json(payload);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await enforceRateLimit(`iris-orgs:${user.email}`, 40, 60 * 1000))) {
    return Response.json({ error: "Too many organization requests." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    name?: string;
    slug?: string;
    plan?: string;
    organizationId?: string;
    email?: string;
    role?: string;
    inviteId?: string;
    token?: string;
    keyId?: string;
    scopes?: string[];
    checkoutSessionId?: string;
    language?: string;
  };

  try {
    if (body.action === "ensure") {
      const created = await ensurePersonalOrganization(user.email, user.displayName);
      return Response.json({ organization: created.organization, membership: created.membership });
    }

    if (body.action === "create") {
      const created = await createOrganization({
        name: String(body.name || ""),
        slug: body.slug,
        plan: body.plan as IrisPlanId | undefined,
        actorEmail: user.email,
      });
      return Response.json(created);
    }

    if (body.action === "switch") {
      const ctx = await requireOrgContext(user.email, { preferredOrgId: String(body.organizationId || "") });
      const response = Response.json({ activeOrganizationId: ctx.organization.id, organization: ctx.organization, membership: ctx.membership });
      response.headers.append(
        "Set-Cookie",
        `${ORG_COOKIE}=${encodeURIComponent(ctx.organization.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      );
      return response;
    }

    if (body.action === "add_member") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const member = await addOrgMember({
        organizationId: ctx.organization.id,
        actorEmail: user.email,
        actorRole: ctx.membership.role as OrgRole,
        email: String(body.email || ""),
        role: (body.role as OrgRole) || "OPERATOR",
      });
      return Response.json({ member, members: await listOrgMembers(ctx.organization.id) });
    }

    if (body.action === "invite") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const result = await createOrgInvite({
        organizationId: ctx.organization.id,
        actorEmail: user.email,
        actorRole: ctx.membership.role as OrgRole,
        email: String(body.email || ""),
        role: body.role,
      });
      // acceptToken returned once to the admin UI; never written to audit in full.
      return Response.json({
        invite: result.invite,
        acceptToken: result.acceptToken,
        invites: await listOrgInvites(ctx.organization.id),
      });
    }

    if (body.action === "revoke_invite") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const result = await revokeOrgInvite({
        organizationId: ctx.organization.id,
        inviteId: String(body.inviteId || ""),
        actorEmail: user.email,
        actorRole: ctx.membership.role as OrgRole,
      });
      return Response.json({ ...result, invites: await listOrgInvites(ctx.organization.id) });
    }

    if (body.action === "accept_invite") {
      const result = await acceptOrgInvite({
        token: String(body.token || ""),
        actorEmail: user.email,
      });
      const response = Response.json(result);
      response.headers.append(
        "Set-Cookie",
        `${ORG_COOKIE}=${encodeURIComponent(result.organizationId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      );
      return response;
    }

    if (body.action === "update_role") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const member = await updateOrgMemberRole({
        organizationId: ctx.organization.id,
        actorEmail: user.email,
        actorRole: ctx.membership.role as OrgRole,
        email: String(body.email || ""),
        role: (body.role as OrgRole) || "OPERATOR",
      });
      return Response.json({ member, members: await listOrgMembers(ctx.organization.id) });
    }

    if (body.action === "remove_member") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const member = await removeOrgMember({
        organizationId: ctx.organization.id,
        actorEmail: user.email,
        actorRole: ctx.membership.role as OrgRole,
        email: String(body.email || ""),
      });
      return Response.json({ member, members: await listOrgMembers(ctx.organization.id) });
    }

    if (body.action === "create_api_key") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const result = await createOrgApiKey({
        organizationId: ctx.organization.id,
        actorEmail: user.email,
        actorRole: ctx.membership.role as OrgRole,
        name: String(body.name || ""),
        scopes: body.scopes,
      });
      return Response.json({
        key: result.key,
        secret: result.secret,
        apiKeys: await listOrgApiKeys(ctx.organization.id),
      });
    }

    if (body.action === "revoke_api_key") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const result = await revokeOrgApiKey({
        organizationId: ctx.organization.id,
        keyId: String(body.keyId || ""),
        actorEmail: user.email,
        actorRole: ctx.membership.role as OrgRole,
      });
      return Response.json({ ...result, apiKeys: await listOrgApiKeys(ctx.organization.id) });
    }

    if (body.action === "billing_test_start") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const checkout = await startTestCheckout({
        organizationId: ctx.organization.id,
        actorEmail: user.email,
        actorRole: ctx.membership.role as OrgRole,
        plan: (body.plan as IrisPlanId) || "business",
        env: billingEnv(),
      });
      return Response.json({
        checkout,
        billing: getBillingProvider(billingEnv()),
        billingEvents: await listBillingEvents(ctx.organization.id),
      });
    }

    if (body.action === "billing_test_confirm") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const confirmed = await confirmTestCheckout({
        organizationId: ctx.organization.id,
        actorEmail: user.email,
        actorRole: ctx.membership.role as OrgRole,
        plan: (body.plan as IrisPlanId) || "business",
        checkoutSessionId: String(body.checkoutSessionId || ""),
        env: billingEnv(),
      });
      const organization = await getOrganization(ctx.organization.id);
      return Response.json({
        confirmed,
        organization,
        billing: getBillingProvider(billingEnv()),
        billingEvents: await listBillingEvents(ctx.organization.id),
      });
    }

    if (body.action === "usage_check") {
      const ctx = await requireOrgContext(user.email);
      const decision = await assertOrgWithinLimits({
        organizationId: ctx.organization.id,
        plan: ctx.organization.plan as IrisPlanId,
        orgStatus: ctx.organization.status,
        budgetCentsMonthly: ctx.organization.budgetCentsMonthly,
        action: "request",
      });
      const payload = { decision, usage: await getMonthlyUsage(ctx.organization.id), billing: getBillingProvider(billingEnv()) };
      assertNoSecretsInPayload(payload, "usage_check");
      return Response.json(payload);
    }

    if (body.action === "export") {
      const ctx = await requireOrgContext(user.email, { admin: true });
      const [creator, mission, memory] = await Promise.all([
        loadOrgDeskValue({ kind: "creator", organizationId: ctx.organization.id, email: user.email }),
        loadOrgDeskValue({ kind: "mission", organizationId: ctx.organization.id, email: user.email }),
        loadOrgDeskValue({ kind: "memory", organizationId: ctx.organization.id, email: user.email }),
      ]);
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        organization: {
          id: ctx.organization.id,
          name: ctx.organization.name,
          slug: ctx.organization.slug,
          plan: ctx.organization.plan,
          status: ctx.organization.status,
          billingMode: ctx.organization.billingMode,
          subscriptionStatus: ctx.organization.subscriptionStatus,
        },
        members: await listOrgMembers(ctx.organization.id),
        invites: await listOrgInvites(ctx.organization.id),
        apiKeys: await listOrgApiKeys(ctx.organization.id),
        usage: await getMonthlyUsage(ctx.organization.id),
        desks: {
          creator: creator.value || null,
          mission: mission.value || null,
          memory: memory.value || null,
        },
        billing: getBillingProvider(billingEnv()),
      };
      assertNoSecretsInPayload(exportPayload, "org_export");
      await logAudit(user.email, "ORG_EXPORT", ctx.organization.id, "SUCCESS", { bytes: JSON.stringify(exportPayload).length }, ctx.organization.id);
      return Response.json(exportPayload);
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "org";
    await logAudit(user.email, "ORG_DENIED", "organization", "DENIED", { message, action: body.action });
    return Response.json({ error: message }, { status: 400 });
  }
}
