ALTER TABLE `crowns` RENAME TO `artist_crowns`;--> statement-breakpoint
DROP INDEX `crowns_guild_artist`;--> statement-breakpoint
CREATE UNIQUE INDEX `artist_crowns_guild_artist` ON `artist_crowns` (`guild_id`,`artist_name`);
