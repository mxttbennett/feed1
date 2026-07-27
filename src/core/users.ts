import { eq } from 'drizzle-orm';
import type { Message, User as DiscordUser } from 'discord.js';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

export type UserRow = typeof schema.users.$inferSelect;

export function getRegisteredUser(db: Db, discordUserId: string): UserRow | null {
  return (
    db.select().from(schema.users).where(eq(schema.users.discordUserId, discordUserId)).get() ??
    null
  );
}

/**
 * Legacy target convention: with an argument the first mention is the target,
 * otherwise the author. Returns null when an arg was given but nothing was mentioned.
 */
export function resolveTargetUser(message: Message, args: string[]): DiscordUser | null {
  if (args.length === 0) return message.author;
  return message.mentions.users.first() ?? null;
}
