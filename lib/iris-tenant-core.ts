/**
 * Pure multi-tenant helpers (no DB / Next imports) — safe for Node unit tests.
 */

export const ORG_COOKIE = "iris_org_id";

export const ORG_ROLES = ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const MUTATING_ROLES: OrgRole[] = ["OWNER", "ADMIN", "OPERATOR"];
const ADMIN_ROLES: OrgRole[] = ["OWNER", "ADMIN"];

/** Higher number = more privilege. Used to block self-elevation and over-assignment. */
const ROLE_RANK: Record<OrgRole, number> = {
  VIEWER: 1,
  OPERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

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

export function roleRank(role: OrgRole) {
  return ROLE_RANK[role] || 0;
}

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

/**
 * Pure privilege gate for member role changes.
 * Blocks self-elevation and assigning a role above the actor's own rank.
 */
export function assertRoleChangeAllowed(input: {
  actorEmail: string;
  actorRole: OrgRole;
  targetEmail: string;
  currentRole: OrgRole;
  nextRole: OrgRole;
}) {
  if (!canAdminOrg(input.actorRole)) {
    throw new Error("Administrator access required");
  }
  if (!isOrgRole(input.nextRole)) {
    throw new Error("Invalid organization role");
  }
  if (input.nextRole === "OWNER" && input.actorRole !== "OWNER") {
    throw new Error("Only an OWNER can promote another OWNER");
  }
  if (roleRank(input.nextRole) > roleRank(input.actorRole)) {
    throw new Error("Cannot assign a role above your own");
  }
  const actor = input.actorEmail.trim().toLowerCase();
  const target = input.targetEmail.trim().toLowerCase();
  if (actor === target && roleRank(input.nextRole) > roleRank(input.currentRole)) {
    throw new Error("Cannot elevate your own privileges");
  }
  return true;
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

export function isValidInviteTokenFormat(token: string) {
  return /^iris_inv_[a-f0-9]{32,}$/i.test(String(token || "").trim());
}

export function inviteIsExpired(expiresAt: string, nowMs = Date.now()) {
  const expires = new Date(expiresAt).getTime();
  return !Number.isFinite(expires) || expires < nowMs;
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

export function isValidOrgApiKeyFormat(token: string) {
  return /^iris_ak_[a-f0-9]{32,}$/i.test(String(token || "").trim());
}

/** Public list/export shapes must never include hash or full secret fields. */
export function assertPublicOrgSecretShape(row: Record<string, unknown>, kind: "invite" | "api_key") {
  const forbidden = ["tokenHash", "token_hash", "keyHash", "key_hash", "acceptToken", "secret", "token"];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && row[key] !== "") {
      throw new Error(`${kind} public shape leaked field: ${key}`);
    }
  }
  if (kind === "api_key" && typeof row.keyPrefix === "string" && isValidOrgApiKeyFormat(row.keyPrefix)) {
    throw new Error("api_key public shape must not contain a full secret as prefix");
  }
  return true;
}
