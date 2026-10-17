CREATE TABLE `organization_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'OPERATOR' NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`invited_by` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_invites_token_hash_unique` ON `organization_invites` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `organization_invites_org_email_idx` ON `organization_invites` (`organization_id`,`email`);
--> statement-breakpoint
CREATE INDEX `organization_invites_org_status_idx` ON `organization_invites` (`organization_id`,`status`);
--> statement-breakpoint
CREATE TABLE `organization_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text DEFAULT '["read"]' NOT NULL,
	`created_by` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_api_keys_key_hash_unique` ON `organization_api_keys` (`key_hash`);
--> statement-breakpoint
CREATE INDEX `organization_api_keys_org_idx` ON `organization_api_keys` (`organization_id`);
--> statement-breakpoint
CREATE TABLE `organization_billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`kind` text NOT NULL,
	`plan` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`mode` text DEFAULT 'test' NOT NULL,
	`provider_ref` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organization_billing_events_org_created_idx` ON `organization_billing_events` (`organization_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_mode` text DEFAULT 'off' NOT NULL;
--> statement-breakpoint
ALTER TABLE `organizations` ADD `subscription_status` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `organizations` ADD `stripe_customer_test_id` text;
