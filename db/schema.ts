import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  displayName: text("display_name"),
  role: text("role", { enum: ["ADMIN", "USER"] }).notNull().default("USER"),
  status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull().default("ACTIVE"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  outcome: text("outcome", { enum: ["SUCCESS", "DENIED"] }).notNull(),
  metadata: text("metadata").notNull().default("{}"),
  previousHash: text("previous_hash"),
  eventHash: text("event_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("audit_events_actor_email_idx").on(table.actorEmail),
  index("audit_events_created_at_idx").on(table.createdAt),
]);

export const incidentStates = sqliteTable("incident_states", {
  incidentId: text("incident_id").primaryKey(),
  status: text("status", { enum: ["Open", "Investigating", "Contained"] }).notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const responseActions = sqliteTable("response_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: text("incident_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  mode: text("mode", { enum: ["SIMULATION", "LIVE"] }).notNull().default("SIMULATION"),
  outcome: text("outcome", { enum: ["APPROVED", "REJECTED", "COMPLETED"] }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  status: text("status", { enum: ["PENDING", "ONLINE", "OFFLINE"] }).notNull().default("PENDING"),
  risk: text("risk", { enum: ["UNKNOWN", "LOW", "MEDIUM", "HIGH"] }).notNull().default("UNKNOWN"),
  enrollmentCode: text("enrollment_code").notNull(),
  agentTokenHash: text("agent_token_hash"),
  agentTokenIssuedAt: text("agent_token_issued_at"),
  agentTokenExpiresAt: text("agent_token_expires_at"),
  telemetry: text("telemetry").notNull().default("{}"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("devices_enrollment_code_unique").on(table.enrollmentCode),
  index("devices_owner_email_idx").on(table.ownerEmail),
  index("devices_agent_token_hash_idx").on(table.agentTokenHash),
]);

export const trustedApplications = sqliteTable("trusted_applications", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  appName: text("app_name").notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedAt: text("approved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("trusted_applications_device_app_unique").on(table.deviceId, table.appName)]);

export const securityAlerts = sqliteTable("security_alerts", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  ownerEmail: text("owner_email").notNull(),
  fingerprint: text("fingerprint").notNull(),
  code: text("code").notNull(),
  severity: text("severity", { enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] }).notNull(),
  status: text("status", { enum: ["NEW", "ACKNOWLEDGED", "RESOLVED"] }).notNull().default("NEW"),
  evidence: text("evidence").notNull().default("{}"),
  firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
  updatedBy: text("updated_by"),
}, (table) => [
  uniqueIndex("security_alerts_fingerprint_unique").on(table.fingerprint),
  index("security_alerts_device_id_idx").on(table.deviceId),
  index("security_alerts_owner_email_idx").on(table.ownerEmail),
]);

export const agentRequestNonces = sqliteTable("agent_request_nonces", {
  nonce: text("nonce").primaryKey(),
  deviceId: text("device_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
});

export const remediationPlans = sqliteTable("remediation_plans", {
  id: text("id").primaryKey(),
  alertId: text("alert_id").notNull(),
  deviceId: text("device_id").notNull(),
  ownerEmail: text("owner_email").notNull(),
  actionCode: text("action_code").notNull(),
  status: text("status", { enum: ["VERIFYING", "VERIFIED", "CANCELLED"] }).notNull().default("VERIFYING"),
  approvedBy: text("approved_by").notNull(),
  approvedAt: text("approved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastCheckedAt: text("last_checked_at"),
  verifiedAt: text("verified_at"),
}, (table) => [uniqueIndex("remediation_plans_alert_unique").on(table.alertId)]);

export const passkeyCredentials = sqliteTable("passkey_credentials", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports").notNull().default("[]"),
  deviceType: text("device_type").notNull(),
  backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
  label: text("label").notNull().default("Touch ID"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at"),
}, (table) => [
  uniqueIndex("passkey_owner_credential_unique").on(table.ownerEmail, table.id),
  index("passkey_credentials_owner_email_idx").on(table.ownerEmail),
]);

export const passkeyChallenges = sqliteTable("passkey_challenges", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  purpose: text("purpose", { enum: ["REGISTER", "AUTHENTICATE"] }).notNull(),
  challenge: text("challenge").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const biometricSessions = sqliteTable("biometric_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userPasswords = sqliteTable("user_passwords", {
  ownerEmail: text("owner_email").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  iterations: integer("iterations").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const irisChainBlocks = sqliteTable("iris_chain_blocks", {
  height: integer("height").primaryKey(),
  hash: text("hash").notNull(),
  previousHash: text("previous_hash").notNull(),
  merkleRoot: text("merkle_root").notNull(),
  transactionCount: integer("transaction_count").notNull().default(0),
  validator: text("validator").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("iris_chain_blocks_hash_unique").on(table.hash)]);

export const irisChainTransactions = sqliteTable("iris_chain_transactions", {
  id: text("id").primaryKey(),
  blockHeight: integer("block_height"),
  actorEmail: text("actor_email").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  payloadHash: text("payload_hash").notNull(),
  status: text("status", { enum: ["PENDING", "CONFIRMED"] }).notNull().default("PENDING"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
