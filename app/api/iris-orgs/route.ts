import { getChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser, logAudit } from "../../../lib/authz";
import { PLAN_LIMITS, type IrisPlanId } from "../../../lib/iris-plans";
import {
  ORG_COOKIE,
  addOrgMember,
  createOrganization,
  ensurePersonalOrganization,
  listMembershipsForEmail,
  listOrgMembers,
  requireOrgContext,
  getOrganization,
  type OrgRole,
} from "../../../lib/iris-tenant";
import { loadOrgDeskValue } from "../../../lib/iris-org-store";
import { assertOrgWithinLimits, getBillingProvider, getMonthlyUsage } from "../../../lib/iris-usage";
import { enforceRateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
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
    });
  }

  const url = new URL(request.url);
  const wantMembers = url.searchParams.get("view") === "members";
  const ctx = await requireOrgContext(user.email);
  const usage = await getMonthlyUsage(ctx.organization.id);
  const limits = PLAN_LIMITS[ctx.organization.plan as IrisPlanId] || PLAN_LIMITS.starter;
  const payload: Record<string, unknown> = {
    activeOrganizationId: ctx.organization.id,
    organizations: orgs,
    usage,
    limits,
    billing: getBillingProvider(),
  };
  if (wantMembers) {
    payload.members = await listOrgMembers(ctx.organization.id);
  }
  return Response.json(payload);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await enforceRateLimit(`iris-orgs:${user.email}`, 30, 60 * 1000))) {
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

    if (body.action === "usage_check") {
      const ctx = await requireOrgContext(user.email);
      const decision = await assertOrgWithinLimits({
        organizationId: ctx.organization.id,
        plan: ctx.organization.plan as IrisPlanId,
        orgStatus: ctx.organization.status,
        budgetCentsMonthly: ctx.organization.budgetCentsMonthly,
        action: "request",
      });
      return Response.json({ decision, usage: await getMonthlyUsage(ctx.organization.id), billing: getBillingProvider() });
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
        organization: ctx.organization,
        members: await listOrgMembers(ctx.organization.id),
        usage: await getMonthlyUsage(ctx.organization.id),
        desks: {
          creator: creator.value || null,
          mission: mission.value || null,
          memory: memory.value || null,
        },
        billing: getBillingProvider(),
      };
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
