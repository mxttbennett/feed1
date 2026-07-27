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
  // A full members.fetch() hits the gateway REQUEST_GUILD_MEMBERS op, which
  // Discord rate-limits; doing it on every command trips GatewayRateLimitError
  // on rapid calls. Fetch only when the cache is missing members — the
  // GuildMembers intent keeps it current afterwards.
  if (guild.members.cache.size < guild.memberCount) {
    await guild.members.fetch().catch(() => undefined);
  }
  const members = guild.members.cache;
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
