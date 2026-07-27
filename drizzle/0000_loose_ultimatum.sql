CREATE TABLE `album_crowns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`artist_name` text NOT NULL,
	`album_name` text NOT NULL,
	`album_plays` integer NOT NULL,
	`server_plays` integer DEFAULT 0 NOT NULL,
	`server_listeners` integer DEFAULT 0 NOT NULL,
	`album_url` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `album_crowns_guild_artist_album` ON `album_crowns` (`guild_id`,`artist_name`,`album_name`);--> statement-breakpoint
CREATE TABLE `crown_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`guild_id` text NOT NULL,
	`artist_name` text NOT NULL,
	`album_name` text,
	`prev_owner_id` text,
	`new_owner_id` text NOT NULL,
	`prev_plays` integer,
	`new_plays` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `crown_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`guild_id` text NOT NULL,
	`artist_name` text NOT NULL,
	`album_name` text DEFAULT '' NOT NULL,
	`requested_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crown_jobs_dedupe` ON `crown_jobs` (`kind`,`guild_id`,`artist_name`,`album_name`);--> statement-breakpoint
CREATE TABLE `crowns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`artist_name` text NOT NULL,
	`artist_plays` integer NOT NULL,
	`server_plays` integer DEFAULT 0 NOT NULL,
	`server_listeners` integer DEFAULT 0 NOT NULL,
	`artist_url` text,
	`artist_img_url` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crowns_guild_artist` ON `crowns` (`guild_id`,`artist_name`);--> statement-breakpoint
CREATE TABLE `disables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text,
	`command_name` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `disables_guild_command` ON `disables` (`guild_id`,`command_name`);--> statement-breakpoint
CREATE TABLE `notif_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`on_win` integer DEFAULT false NOT NULL,
	`on_loss` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scan_timings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`guild_id` text NOT NULL,
	`ms` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`discord_user_id` text NOT NULL,
	`lastfm_username` text NOT NULL,
	`rym_username` text,
	`rym_per_page` integer DEFAULT 0 NOT NULL,
	`rym_max` integer DEFAULT 0 NOT NULL,
	`wish_max` integer DEFAULT 0 NOT NULL,
	`tag_max` integer DEFAULT 0 NOT NULL,
	`tag` text,
	`chart_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_discord_user_id_unique` ON `users` (`discord_user_id`);