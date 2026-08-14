CREATE TABLE `banner_configs` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`interval_minutes` integer NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_image_id` integer,
	`last_applied_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`set_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `banner_configs_next_run` ON `banner_configs` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `banner_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`sha256` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`animated` integer DEFAULT false NOT NULL,
	`source_url` text,
	`added_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `banner_images_guild_sha` ON `banner_images` (`guild_id`,`sha256`);