import { eq } from 'drizzle-orm';
import type { Client } from 'discord.js';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { CrownChange } from './service.js';

function crownLabel(change: CrownChange): string {
  return change.kind === 'album'
    ? `**${change.artistName}** — **${change.albumName}** album crown`
    : `**${change.artistName}** artist crown`;
}

/**
 * DM the winner/loser of a crown transfer, matching the legacy wording exactly.
 * Play counts ride in the change payload — no re-fetching, no kind-guessing by exception.
 */
export async function notifyCrownChange(
  client: Client,
  db: Db,
  change: CrownChange,
): Promise<void> {
  if (!change.prevOwnerId || change.prevOwnerId === change.newOwnerId) return;

  const prefs = (id: string) =>
    db.select().from(schema.notifPrefs).where(eq(schema.notifPrefs.userId, id)).get();

  const [prevUser, newUser] = await Promise.all([
    client.users.fetch(change.prevOwnerId).catch(() => null),
    client.users.fetch(change.newOwnerId).catch(() => null),
  ]);

  if (newUser && prefs(change.newOwnerId)?.onWin) {
    await newUser
      .send(
        `You have won the ${crownLabel(change)} in **${change.guildName}**. ` +
          `The previous owner was **${prevUser?.tag ?? 'unknown'}**.\n` +
          `Your play count: \`${change.newPlays}\`\n` +
          `Their play count: \`${change.prevPlays ?? 0}\``,
      )
      .catch(() => undefined);
  }

  if (prevUser && prefs(change.prevOwnerId)?.onLoss) {
    await prevUser
      .send(
        `You have lost your ${crownLabel(change)} in **${change.guildName}** ` +
          `to **${newUser?.tag ?? 'unknown'}**.\n` +
          `Your play count: \`${change.prevPlays ?? 0}\`\n` +
          `Their play count: \`${change.newPlays}\``,
      )
      .catch(() => undefined);
  }
}
