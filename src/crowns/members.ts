import { inArray } from 'drizzle-orm';
import type { Guild } from 'discord.js';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { RegisteredMember } from './service.js';

/** Guild members who have a Last.fm login, in the shape the crown service consumes. */
export async function gatherRegisteredMembers(
  db: Db,
  guild: Guild,
): Promise<RegisteredMember[]> {
  const members = await guild.members.fetch();
  const ids = [...members.filter((m) => !m.user.bot).keys()];
  if (ids.length === 0) return [];

  const rows = db
    .select()
    .from(schema.users)
    .where(inArray(schema.users.discordUserId, ids))
    .all();

  return rows.map((row) => ({
    userId: row.discordUserId,
    tag: members.get(row.discordUserId)?.user.tag ?? row.discordUserId,
    lastfmUsername: row.lastfmUsername,
  }));
}
