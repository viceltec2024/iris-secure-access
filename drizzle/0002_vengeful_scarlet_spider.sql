ALTER TABLE `devices` ADD `agent_token_hash` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `telemetry` text DEFAULT '{}' NOT NULL;