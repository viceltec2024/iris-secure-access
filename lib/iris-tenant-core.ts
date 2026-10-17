/**
 * Pure multi-tenant helpers (no DB / Next imports) — safe for Node unit tests.
 */

export const ORG_COOKIE = "iris_org_id";

export const ORG_ROLES = ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const MUTATING_ROLES: OrgRole[] = ["OWNER", "ADMIN", "OPERATOR"];
const ADMIN_ROLES: OrgRole[] = ["OWNER", "ADMIN"];

export function orgDeskKey(kind: "creator" | "mission" | "memory" | "purchase", organizationId: string) {
  return `iris_${kind === "creator" ? "creator_desk" : kind === "mission" ? "mission_desk" : kind === "memory" ? "memory" : "purchase_desk"}:org:${organizationId}`;
}

export function legacyEmailDeskKey(kind: "creator" | "mission" | "memory", email: string) {
  if (kind === "memory") return `iris_memory:${email}`;
  return `iris_${kind}_desk:${email}`;
}

export function canMutateOrg(role: OrgRole) {
  return MUTATING_ROLES.includes(role);
}

export function canAdminOrg(role: OrgRole) {
  return ADMIN_ROLES.includes(role);
}

/** Pure helper for tests: assert two org desk keys never collide. */
export function assertTenantKeyIsolation(orgA: string, orgB: string) {
  if (orgA === orgB) throw new Error("orgs must differ");
  const keysA = ["creator", "mission", "memory"] as const;
  for (const kind of keysA) {
    if (orgDeskKey(kind, orgA) === orgDeskKey(kind, orgB)) throw new Error("tenant key collision");
  }
  return true;
}

const INVITE_ROLES: Array<Exclude<OrgRole, "OWNER">> = ["ADMIN", "OPERATOR", "VIEWER"];

export function sanitizeInviteRole(role: string | undefined): Exclude<OrgRole, "OWNER"> {
  const value = String(role || "OPERATOR").toUpperCase();
  if (value === "ADMIN" || value === "OPERATOR" || value === "VIEWER") return value;
  return "OPERATOR";
}

export function inviteRoleAllowed(role: string) {
  return INVITE_ROLES.includes(role as Exclude<OrgRole, "OWNER">);
}

export type OrgKeyScope = "read" | "missions" | "creator" | "admin";

export function normalizeOrgKeyScopes(scopes: unknown): OrgKeyScope[] {
  const allowed: OrgKeyScope[] = ["read", "missions", "creator", "admin"];
  if (!Array.isArray(scopes) || !scopes.length) return ["read"];
  const next = scopes
    .map(item => String(item).toLowerCase())
    .filter((item): item is OrgKeyScope => allowed.includes(item as OrgKeyScope));
  return next.length ? Array.from(new Set(next)) : ["read"];
}
