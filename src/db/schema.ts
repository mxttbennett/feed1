import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  discordUserId: text('discord_user_id').notNull().unique(),
  lastfmUsername: text('lastfm_username').notNull(),
  rymUsername: text('rym_username'),
  rymPerPage: integer('rym_per_page').notNull().default(0),
  rymMax: integer('rym_max').notNull().default(0),
  wishMax: integer('wish_max').notNull().default(0),
  tagMax: integer('tag_max').notNull().default(0),
  tag: text('tag'),
  chartUrl: text('chart_url'),
  createdAt: createdAt(),
});

export const crowns = sqliteTable(
  'crowns',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    artistName: text('artist_name').notNull(),
    artistPlays: integer('artist_plays').notNull(),
    serverPlays: integer('server_plays').notNull().default(0),
    serverListeners: integer('server_listeners').notNull().default(0),
    artistUrl: text('artist_url'),
    artistImgUrl: text('artist_img_url'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex('crowns_guild_artist').on(t.guildId, t.artistName)],
);

export const albumCrowns = sqliteTable(
  'album_crowns',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    artistName: text('artist_name').notNull(),
    albumName: text('album_name').notNull(),
    albumPlays: integer('album_plays').notNull(),
    serverPlays: integer('server_plays').notNull().default(0),
    serverListeners: integer('server_listeners').notNull().default(0),
    albumUrl: text('album_url'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex('album_crowns_guild_artist_album').on(t.guildId, t.artistName, t.albumName)],
);

export const disables = sqliteTable(
  'disables',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    /** null = guild-wide disable */
    channelId: text('channel_id'),
    commandName: text('command_name').notNull(),
  },
  (t) => [index('disables_guild_command').on(t.guildId, t.commandName)],
);

export const notifPrefs = sqliteTable('notif_prefs', {
  userId: text('user_id').primaryKey(),
  onWin: integer('on_win', { mode: 'boolean' }).notNull().default(false),
  onLoss: integer('on_loss', { mode: 'boolean' }).notNull().default(false),
});

export const crownJobs = sqliteTable(
  'crown_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: ['artist', 'album'] }).notNull(),
    guildId: text('guild_id').notNull(),
    artistName: text('artist_name').notNull(),
    /** empty string for artist jobs, so the unique index applies uniformly */
    albumName: text('album_name').notNull().default(''),
    requestedBy: text('requested_by').notNull(),
    status: text('status', { enum: ['pending', 'processing'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('crown_jobs_dedupe').on(t.kind, t.guildId, t.artistName, t.albumName)],
);

export const crownAudit = sqliteTable('crown_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['artist', 'album'] }).notNull(),
  guildId: text('guild_id').notNull(),
  artistName: text('artist_name').notNull(),
  albumName: text('album_name'),
  prevOwnerId: text('prev_owner_id'),
  newOwnerId: text('new_owner_id').notNull(),
  prevPlays: integer('prev_plays'),
  newPlays: integer('new_plays').notNull(),
  createdAt: createdAt(),
});

export const scanTimings = sqliteTable('scan_timings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['artist', 'album'] }).notNull(),
  guildId: text('guild_id').notNull(),
  ms: integer('ms').notNull(),
  createdAt: createdAt(),
});
