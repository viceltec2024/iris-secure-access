CREATE TABLE `agent_request_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD `previous_hash` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `event_hash` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `agent_token_issued_at` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `agent_token_expires_at` text;