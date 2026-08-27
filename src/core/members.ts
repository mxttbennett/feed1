import type { Collection, Guild, GuildMember } from 'discord.js';

/**
 * A full members.fetch() hits the gateway REQUEST_GUILD_MEMBERS op, which Discord
 * rate-limits; doing it on every command trips GatewayRateLimitError on rapid calls.
 * Fetch only when the cache is missing members — the GuildMembers intent keeps it
 * current afterwards.
 */
export async function guildMemberCache(guild: Guild): Promise<Collection<string, GuildMember>> {
  if (guild.members.cache.size < guild.memberCount) {
    await guild.members.fetch().catch(() => undefined);
  }
  return guild.members.cache;
}
