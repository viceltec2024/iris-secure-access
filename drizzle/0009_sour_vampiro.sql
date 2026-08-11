CREATE TABLE `iris_chain_blocks` (
	`height` integer PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`previous_hash` text NOT NULL,
	`merkle_root` text NOT NULL,
	`transaction_count` integer DEFAULT 0 NOT NULL,
	`validator` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `iris_chain_blocks_hash_unique` ON `iris_chain_blocks` (`hash`);--> statement-breakpoint
CREATE TABLE `iris_chain_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`block_height` integer,
	`actor_email` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
