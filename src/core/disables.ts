import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

export type DisableScope = 'channel' | 'guild' | null;

/** Where (if anywhere) this canonical command is disabled for the given channel. */
export function disabledScope(
  db: Db,
  guildId: string,
  channelId: string,
  commandName: string,
): DisableScope {
  const rows = db
    .select()
    .from(schema.disables)
    .where(and(eq(schema.disables.guildId, guildId), eq(schema.disables.commandName, commandName)))
    .all();
  if (rows.some((r) => r.channelId === null)) return 'guild';
  if (rows.some((r) => r.channelId === channelId)) return 'channel';
  return null;
}

export function disableCommand(
  db: Db,
  guildId: string,
  commandName: string,
  channelId: string | null,
): boolean {
  const existing = db
    .select()
    .from(schema.disables)
    .where(and(eq(schema.disables.guildId, guildId), eq(schema.disables.commandName, commandName)))
    .all();
  if (existing.some((r) => r.channelId === channelId)) return false;
  db.insert(schema.disables).values({ guildId, commandName, channelId }).run();
  return true;
}

export function enableCommand(
  db: Db,
  guildId: string,
  commandName: string,
  channelId: string | null,
): boolean {
  const rows = db
    .select()
    .from(schema.disables)
    .where(and(eq(schema.disables.guildId, guildId), eq(schema.disables.commandName, commandName)))
    .all();
  const match = rows.find((r) => r.channelId === channelId);
  if (!match) return false;
  db.delete(schema.disables).where(eq(schema.disables.id, match.id)).run();
  return true;
}
