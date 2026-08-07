CREATE TABLE `banner_configs` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`album_url` text NOT NULL,
	`album_hash` text NOT NULL,
	`interval_minutes` integer NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_image_url` text,
	`last_applied_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`set_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `banner_configs_next_run` ON `banner_configs` (`next_run_at`);