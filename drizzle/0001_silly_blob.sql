CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`risk` text DEFAULT 'UNKNOWN' NOT NULL,
	`enrollment_code` text NOT NULL,
	`last_seen_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_enrollment_code_unique` ON `devices` (`enrollment_code`);--> statement-breakpoint
CREATE TABLE `incident_states` (
	`incident_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `response_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`mode` text DEFAULT 'SIMULATION' NOT NULL,
	`outcome` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
