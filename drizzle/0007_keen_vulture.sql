CREATE TABLE `biometric_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passkey_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`purpose` text NOT NULL,
	`challenge` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passkey_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text DEFAULT '[]' NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT false NOT NULL,
	`label` text DEFAULT 'Touch ID' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_owner_credential_unique` ON `passkey_credentials` (`owner_email`,`id`);