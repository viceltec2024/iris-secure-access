CREATE TABLE `remediation_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`alert_id` text NOT NULL,
	`device_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`action_code` text NOT NULL,
	`status` text DEFAULT 'VERIFYING' NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_checked_at` text,
	`verified_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remediation_plans_alert_unique` ON `remediation_plans` (`alert_id`);