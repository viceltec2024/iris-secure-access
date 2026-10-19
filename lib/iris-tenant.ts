/**
 * Multi-tenant organization context for IRIS SaaS.
 * All product desks are scoped by organizationId. Server validates membership.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  organizationMembers,
  organizations,
} from "../db/schema";
import { PLAN_LIMITS, type IrisPlanId } from "./iris-plans.ts";
import { logAudit } from "./authz.ts";
import {
  ORG_COOKIE,
  ORG_ROLES,
  assertRoleChangeAllowed,
  assertTenantKeyIsolation,
  canAdminOrg,
  canMutateOrg,
  legacyEmailDeskKey,
  orgDeskKey,
  type OrgRole,
} from "./iris-tenant-core.ts";

export {
  ORG_COOKIE,
  ORG_ROLES,
  assertRoleChangeAllowed,
  assertTenantKeyIsolation,
  canAdminOrg,
  canMutateOrg,
  legacyEmailDeskKey,
  orgDeskKey,
  type OrgRole,
};

export type OrganizationRow = typeof organizations.$inferSelect;
export type MembershipRow = typeof organizationMembers.$inferSelect;

export type OrgContext = {
  organization: OrganizationRow;
  membership: MembershipRow;
  email: string;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "org";
}

export async function listMembershipsForEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return getDb()
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userEmail, normalized), eq(organizationMembers.status, "ACTIVE")));
}

export async function getOrganization(orgId: string) {
  const [org] = await getDb().select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return org || null;
}

export async function getMembership(orgId: string, email: string) {
  const [row] = await getDb()
    .select()
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.organizationId, orgId),
      eq(organizationMembers.userEmail, email.trim().toLowerCase()),
      eq(organizationMembers.status, "ACTIVE"),
    ))
    .limit(1);
  return row || null;
}

export async function ensurePersonalOrganization(email: string, displayName?: string | null) {
  const normalized = email.trim().toLowerCase();
  const existing = await listMembershipsForEmail(normalized);
  if (existing[0]) {
    const org = await getOrganization(existing[0].organizationId);
    if (org) return { organization: org, membership: existing[0] };
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const base = slugify(displayName || normalized.split("@")[0] || "empresa");
  let slug = `personal-${base}`;
  // Ensure unique slug
  for (let i = 0; i < 5; i += 1) {
    const [clash] = await getDb().select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (!clash) break;
    slug = `personal-${base}-${id.slice(0, 6)}`;
  }

  const [org] = await getDb().insert(organizations).values({
    id,
    slug,
    name: displayName?.trim() || `${normalized.split("@")[0]} Workspace`,
    plan: "starter",
    status: "ACTIVE",
    budgetCentsMonthly: PLAN_LIMITS.starter.defaultBudgetCents,
    createdBy: normalized,
    createdAt: now,
    updatedAt: now,
  }).returning();

  const [membership] = await getDb().insert(organizationMembers).values({
    id: crypto.randomUUID(),
    organizationId: org.id,
    userEmail: normalized,
    role: "OWNER",
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  }).returning();

  await logAudit(normalized, "ORG_CREATED", org.id, "SUCCESS", { slug: org.slug, plan: org.plan }, org.id);
  return { organization: org, membership };
}

export async function createOrganization(input: {
  name: string;
  slug?: string;
  plan?: IrisPlanId;
  actorEmail: string;
}) {
  const name = String(input.name || "").trim().slice(0, 120);
  if (name.length < 2) throw new Error("Organization name required");
  const normalized = input.actorEmail.trim().toLowerCase();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  let slug = slugify(input.slug || name);
  const [clash] = await getDb().select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (clash) slug = `${slug}-${id.slice(0, 6)}`;
  const plan = (input.plan && PLAN_LIMITS[input.plan] ? input.plan : "starter") as IrisPlanId;

  const [org] = await getDb().insert(organizations).values({
    id,
    slug,
    name,
    plan,
    status: "ACTIVE",
    budgetCentsMonthly: PLAN_LIMITS[plan].defaultBudgetCents,
    createdBy: normalized,
    createdAt: now,
    updatedAt: now,
  }).returning();

  const [membership] = await getDb().insert(organizationMembers).values({
    id: crypto.randomUUID(),
    organizationId: org.id,
    userEmail: normalized,
    role: "OWNER",
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  }).returning();

  await logAudit(normalized, "ORG_CREATED", org.id, "SUCCESS", { slug, plan }, org.id);
  return { organization: org, membership };
}

export async function addOrgMember(input: {
  organizationId: string;
  actorEmail: string;
  actorRole: OrgRole;
  email: string;
  role: OrgRole;
}) {
  if (!canAdminOrg(input.actorRole)) throw new Error("Administrator access required");
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Valid email required");
  if (email === input.actorEmail.trim().toLowerCase()) {
    throw new Error("Cannot add yourself as a member");
  }
  const assignedRole: OrgRole = input.role === "OWNER" ? "ADMIN" : input.role;
  // Reuse privilege gate against a neutral baseline (VIEWER) for the new seat.
  assertRoleChangeAllowed({
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    targetEmail: email,
    currentRole: "VIEWER",
    nextRole: assignedRole,
  });
  const now = new Date().toISOString();
  const existing = await getMembership(input.organizationId, email);
  if (existing) throw new Error("Member already exists");
  const [row] = await getDb().insert(organizationMembers).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    userEmail: email,
    role: assignedRole,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  }).returning();
  await logAudit(input.actorEmail, "ORG_MEMBER_ADDED", input.organizationId, "SUCCESS", { email, role: row.role }, input.organizationId);
  return row;
}

export async function listOrgMembers(organizationId: string) {
  return getDb()
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "ACTIVE")))
    .orderBy(desc(organizationMembers.createdAt));
}

export async function countActiveOwners(organizationId: string) {
  const rows = await getDb()
    .select()
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.status, "ACTIVE"),
      eq(organizationMembers.role, "OWNER"),
    ));
  return rows.length;
}

export async function updateOrgMemberRole(input: {
  organizationId: string;
  actorEmail: string;
  actorRole: OrgRole;
  email: string;
  role: OrgRole;
}) {
  const email = input.email.trim().toLowerCase();
  const member = await getMembership(input.organizationId, email);
  if (!member) throw new Error("Member not found");
  assertRoleChangeAllowed({
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    targetEmail: email,
    currentRole: member.role as OrgRole,
    nextRole: input.role,
  });
  if (member.role === "OWNER" && input.role !== "OWNER") {
    const owners = await countActiveOwners(input.organizationId);
    if (owners <= 1) throw new Error("Cannot demote the last OWNER");
  }
  const now = new Date().toISOString();
  const [row] = await getDb().update(organizationMembers).set({
    role: input.role,
    updatedAt: now,
  }).where(eq(organizationMembers.id, member.id)).returning();
  await logAudit(input.actorEmail, "ORG_MEMBER_ROLE_UPDATED", input.organizationId, "SUCCESS", {
    email,
    from: member.role,
    to: row.role,
  }, input.organizationId);
  return row;
}

export async function removeOrgMember(input: {
  organizationId: string;
  actorEmail: string;
  actorRole: OrgRole;
  email: string;
}) {
  if (!canAdminOrg(input.actorRole)) throw new Error("Administrator access required");
  const email = input.email.trim().toLowerCase();
  if (email === input.actorEmail.trim().toLowerCase()) throw new Error("Cannot remove yourself");
  const member = await getMembership(input.organizationId, email);
  if (!member) throw new Error("Member not found");
  if (member.role === "OWNER") {
    const owners = await countActiveOwners(input.organizationId);
    if (owners <= 1) throw new Error("Cannot remove the last OWNER");
  }
  const now = new Date().toISOString();
  const [row] = await getDb().update(organizationMembers).set({
    status: "REMOVED",
    updatedAt: now,
  }).where(eq(organizationMembers.id, member.id)).returning();
  await logAudit(input.actorEmail, "ORG_MEMBER_REMOVED", input.organizationId, "SUCCESS", {
    email,
    role: member.role,
  }, input.organizationId);
  return row;
}

export async function resolveActiveOrganization(email: string, preferredOrgId?: string | null): Promise<OrgContext> {
  const normalized = email.trim().toLowerCase();
  const memberships = await listMembershipsForEmail(normalized);
  if (!memberships.length) {
    const created = await ensurePersonalOrganization(normalized);
    return { organization: created.organization, membership: created.membership, email: normalized };
  }

  let membership = preferredOrgId
    ? memberships.find(item => item.organizationId === preferredOrgId)
    : undefined;
  if (!membership) membership = memberships[0];

  const organization = await getOrganization(membership.organizationId);
  if (!organization) {
    const created = await ensurePersonalOrganization(normalized);
    return { organization: created.organization, membership: created.membership, email: normalized };
  }
  return { organization, membership, email: normalized };
}

export async function requireOrgContext(email: string, options?: {
  preferredOrgId?: string | null;
  mutate?: boolean;
  admin?: boolean;
}): Promise<OrgContext> {
  let preferred = options?.preferredOrgId;
  if (preferred === undefined) {
    // Dynamic import keeps pure helpers loadable in Node tests via iris-tenant-core.
    const { cookies } = await import("next/headers");
    preferred = (await cookies()).get(ORG_COOKIE)?.value || null;
  }
  const ctx = await resolveActiveOrganization(email, preferred);
  if (ctx.organization.status !== "ACTIVE" && options?.mutate) {
    await logAudit(email, "ORG_ACCESS", ctx.organization.id, "DENIED", { reason: "org_suspended" }, ctx.organization.id);
    throw new Error("Organization is suspended");
  }
  if (options?.mutate && !canMutateOrg(ctx.membership.role as OrgRole)) {
    await logAudit(email, "ORG_ACCESS", ctx.organization.id, "DENIED", { reason: "role_cannot_mutate", role: ctx.membership.role }, ctx.organization.id);
    throw new Error("Insufficient organization role");
  }
  if (options?.admin && !canAdminOrg(ctx.membership.role as OrgRole)) {
    await logAudit(email, "ORG_ACCESS", ctx.organization.id, "DENIED", { reason: "role_not_admin", role: ctx.membership.role }, ctx.organization.id);
    throw new Error("Organization administrator access required");
  }
  return ctx;
}
