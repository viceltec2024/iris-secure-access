import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
  telemetry: text("telemetry").notNull().default("{}"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("devices_enrollment_code_unique").on(table.enrollmentCode)]);

export const trustedApplications = sqliteTable("trusted_applications", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  appName: text("app_name").notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedAt: text("approved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("trusted_applications_device_app_unique").on(table.deviceId, table.appName)]);
