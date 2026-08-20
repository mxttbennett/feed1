CREATE TABLE `command_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`command_name` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_used` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_usage_user_command` ON `command_usage` (`user_id`,`command_name`);--> statement-breakpoint
ALTER TABLE `users` ADD `command_count` integer DEFAULT 0 NOT NULL;