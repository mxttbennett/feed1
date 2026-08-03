import { EmbedBuilder } from 'discord.js';
import type { Command, CommandContext } from '../core/command.js';
import { getRegisteredUser } from '../core/users.js';
import { sendable } from '../core/channel.js';
import { gatherRegisteredMembers } from '../crowns/members.js';
import { CrownService, type ScanResult } from '../crowns/service.js';
import { notifyCrownChange } from '../crowns/notify.js';
import { paginateLines, sendPaginatedEmbed } from '../core/paginate.js';
import { CROWN_GIF_OWN } from './fmFormat.js';

function listenerLines(result: ScanResult): string[] {
  return result.listeners
    .filter((l) => l.plays > 0)
    .map((l, i) => {
      const pct = parseFloat(((l.plays / result.totalPlays) * 100).toFixed(2));
      const word = l.plays !== 1 ? 'scrobbles' : 'scrobble';
      return `${i + 1}. ${l.tag.replace(/#0$/, '')} → **${l.plays}** ${word} (${pct}%)`;
    });
}

function scanFooter(result: ScanResult): string {
  const { totalPlays: total, listenerCount: listeners } = result;
  const avg = listeners > 0 ? parseFloat((total / listeners).toFixed(2)) : 0;
  const scrobbleWord = total !== 1 ? 'scrobbles' : 'scrobble';
  const listenerWord = listeners !== 1 ? 'listeners' : 'listener';
  const seconds = parseFloat((result.tookMs / 1000).toFixed(2));
  return (
    `${total} ${scrobbleWord} | ${listeners} ${listenerWord} | ${avg} avg\n` +
    `this crown check took ${seconds} seconds`
  );
}

async function runWhoKnows(ctx: CommandContext, kind: 'artist' | 'album'): Promise<unknown> {
  const { app, message, args } = ctx;
  const registered = getRegisteredUser(app.db, message.author.id);
  if (!registered) return message.reply(app.snippets.noLogin);
  const guild = message.guild!;

  // resolve target artist/album: explicit args or the caller's current track
  let artistName: string;
  let albumName: string | undefined;
  const joined = args.join(' ').trim();
  if (joined) {
    if (kind === 'album' && joined.includes(' | ')) {
      const [artistPart, albumPart] = joined.split(' | ');
      artistName = artistPart!.trim();
      albumName = albumPart?.trim();
    } else if (kind === 'album') {
      return message.reply(
        `please use \`${app.config.prefix}a <artist> | <album>\` or run it with no ` +
          `arguments while listening to something.`,
      );
    } else {
      artistName = joined;
    }
  } else {
    const track = await app.lastfm.getLatestTrack(registered.lastfmUsername);
    if (!track) return message.reply(app.snippets.notPlaying);
    artistName = track.artist['#text'];
    albumName = kind === 'album' ? track.album['#text'] : undefined;
  }
  if (kind === 'album' && !albumName) {
    return message.reply(`I couldn't work out which album to check.`);
  }

  const checking = await sendable(message).send(
    `checking who knows ${kind === 'album' ? `**${artistName}** — **${albumName}**` : `**${artistName}**`}...`,
  );

  const members = await gatherRegisteredMembers(app.db, guild);
  if (members.length === 0) {
    return checking.edit(`nobody in this server has registered a last.fm account.`);
  }

  const service = new CrownService(app.db, app.lastfm, app.guildScanLock, (change) =>
    notifyCrownChange(message.client, app.db, change),
  );

  // one guild-wide fan-out at a time
  const result = await app.guildScanLock.run(`scan:${guild.id}`, () =>
    service.scan(
      {
        guildId: guild.id,
        guildName: guild.name,
        artistName,
        ...(kind === 'album' ? { albumName: albumName! } : {}),
      },
      members,
    ),
  );

  const lines = listenerLines(result);
  if (lines.length === 0) {
    return checking.edit(
      `nobody in this server has scrobbled ` +
        (kind === 'album' ? `**${result.artistName}** — **${result.albumName}**.` : `**${result.artistName}**.`),
    );
  }

  const footer = scanFooter(result);
  const makeEmbed = (description: string) => {
    const embed = new EmbedBuilder()
      .setColor(message.member?.displayColor ?? null)
      .setDescription(description)
      .setFooter({ text: footer, iconURL: message.author.displayAvatarURL() });
    if (kind === 'album') {
      embed
        .setAuthor({
          name: result.artistName,
          iconURL: CROWN_GIF_OWN,
          ...(result.artistUrl ? { url: result.artistUrl } : {}),
        })
        .setTitle(`*${result.albumName}*`);
      if (result.albumUrl) embed.setURL(result.albumUrl);
      if (result.imageUrl) embed.setThumbnail(result.imageUrl);
    } else {
      embed.setTitle(result.artistName);
      if (result.artistUrl) embed.setURL(result.artistUrl);
      if (result.imageUrl) embed.setThumbnail(result.imageUrl);
    }
    return embed;
  };

  await checking.delete().catch(() => undefined);
  const pages = paginateLines(lines, 10).map(makeEmbed);
  return sendPaginatedEmbed(message, pages, message.author.id);
}

const wk: Command = {
  name: 'wk',
  description:
    'Shows who in this server has scrobbled an artist the most, and settles the artist crown. ' +
    'With no arguments it checks the artist you are currently listening to.',
  usage: 'wk [artist name]',
  guildOnly: true,
  run: (ctx) => runWhoKnows(ctx, 'artist'),
};

const a: Command = {
  name: 'a',
  description:
    'Shows who in this server has scrobbled an album the most, and settles the album crown. ' +
    'With no arguments it checks the album you are currently listening to.',
  usage: 'a [artist | album]',
  guildOnly: true,
  run: (ctx) => runWhoKnows(ctx, 'album'),
};

export const whoKnowsCommands: Command[] = [wk, a];
