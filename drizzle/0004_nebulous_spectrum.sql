CREATE TABLE `security_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`fingerprint` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`evidence` text DEFAULT '{}' NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_alerts_fingerprint_unique` ON `security_alerts` (`fingerprint`);