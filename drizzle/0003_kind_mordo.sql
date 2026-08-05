CREATE TABLE `trusted_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`app_name` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_applications_device_app_unique` ON `trusted_applications` (`device_id`,`app_name`);