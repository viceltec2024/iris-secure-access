CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'starter' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`budget_cents_monthly` integer DEFAULT 2500 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);
--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_email` text NOT NULL,
	`role` text DEFAULT 'OPERATOR' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_org_email_unique` ON `organization_members` (`organization_id`,`user_email`);
--> statement-breakpoint
CREATE INDEX `organization_members_user_email_idx` ON `organization_members` (`user_email`);
--> statement-breakpoint
CREATE TABLE `organization_usage_monthly` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`period` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`missions` integer DEFAULT 0 NOT NULL,
	`agent_runs` integer DEFAULT 0 NOT NULL,
	`estimated_cost_cents` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_usage_monthly_org_period_unique` ON `organization_usage_monthly` (`organization_id`,`period`);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`kind` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`estimated_cost_cents` integer DEFAULT 0 NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_events_org_created_idx` ON `usage_events` (`organization_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD `organization_id` text;
--> statement-breakpoint
CREATE INDEX `audit_events_organization_id_idx` ON `audit_events` (`organization_id`);
