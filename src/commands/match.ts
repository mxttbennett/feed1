import type { Command } from '../core/command.js';
import { sendable } from '../core/channel.js';
import { getRegisteredUser } from '../core/users.js';
import { gatherRegisteredMembers } from '../crowns/members.js';
import { LastfmError } from '../lastfm/errors.js';
import {
  ARTISTS_COMPARED,
  buildMatchEmbed,
  buildProfile,
  compare,
  type MatchResult,
} from './matchFormat.js';

const MAX_MEMBERS = 60;

const match: Command = {
  name: 'taste',
  aliases: ['match', 'twin'],
  description: 'Ranks the server by how closely their taste matches yours.',
  usage: 'match',
  notes: 'Compares everyone logged in here on their all-time top 200 artists.',
  guildOnly: true,
  async run({ app, message }) {
    const registered = getRegisteredUser(app.db, message.author.id);
    if (!registered) return message.reply(app.snippets.noLogin);
    const guild = message.guild!;

    const members = (await gatherRegisteredMembers(app.db, guild)).filter(
      (m) => m.userId !== message.author.id,
    );
    if (members.length === 0) {
      return message.reply(`nobody else in this server has registered a last.fm account.`);
    }
    if (members.length > MAX_MEMBERS) {
      return message.reply(
        `this server has too many members logged in to compare (max ${MAX_MEMBERS}).`,
      );
    }

    const checking = await sendable(message).send(
      `comparing your taste with ${members.length} ${members.length === 1 ? 'member' : 'members'}...`,
    );

    const result = await app.guildScanLock.run(`match:${guild.id}`, async () => {
      const mine = buildProfile(
        message.author.tag,
        (await app.lastfm.getTopArtists(registered.lastfmUsername, 'overall', ARTISTS_COMPARED))
          .topartists.artist,
      );
      const matches: MatchResult[] = [];
      let skipped = 0;
      for (const member of members) {
        try {
          const top = await app.lastfm.getTopArtists(
            member.lastfmUsername,
            'overall',
            ARTISTS_COMPARED,
          );
          const profile = buildProfile(member.tag, top.topartists.artist);
          if (profile.artists.size === 0) skipped++;
          else matches.push(compare(mine, profile));
        } catch (error) {
          if (error instanceof LastfmError && !error.retryable) skipped++;
          else throw error;
        }
      }
      return { matches, skipped };
    });

    return checking.edit({
      content: '',
      embeds: [buildMatchEmbed(message.author.tag, result.matches, result.skipped)],
    });
  },
};

export const matchCommands: Command[] = [match];
