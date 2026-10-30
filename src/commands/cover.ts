import { EmbedBuilder } from 'discord.js';
import type { Command } from '../core/command.js';
import { sendable } from '../core/channel.js';
import { getRegisteredUser } from '../core/users.js';
import { LastfmError } from '../lastfm/errors.js';
import { highestResImageUrl } from '../lastfm/types.js';

const LASTFM_DOWN_REPLY = `Last.fm isn't responding right now, try again in a moment.`;

const cover: Command = {
  name: 'cover',
  aliases: ['art', 'albumart'],
  description: 'Shows the full-size cover art of an album, or of what you are playing.',
  usage: 'cover [artist | album]',
  notes: 'With no arguments, uses your now playing (or last scrobbled) album.',
  guildOnly: false,
  async run({ app, message, args }) {
    let artist: string;
    let album: string;

    if (args.length === 0) {
      const registered = getRegisteredUser(app.db, message.author.id);
      if (!registered) return message.reply(app.snippets.noLogin);
      try {
        const track = await app.lastfm.getLatestTrack(registered.lastfmUsername);
        if (!track) return message.reply(app.snippets.notPlaying);
        artist = track.artist['#text'];
        album = track.album['#text'];
      } catch {
        return message.reply(LASTFM_DOWN_REPLY);
      }
      if (!album) return message.reply(`that track has no album on Last.fm, so there's no cover.`);
    } else {
      const [artistPart, ...albumParts] = args.join(' ').split('|');
      artist = (artistPart ?? '').trim();
      album = albumParts.join('|').trim();
      if (!artist || !album) {
        return message.reply(
          `give me an artist and album like \`${app.config.prefix}cover artist | album\`.`,
        );
      }
    }

    try {
      const { album: info } = await app.lastfm.getAlbumInfo(artist, album);
      const image = highestResImageUrl(info.image);
      if (!image)
        return message.reply(`Last.fm has no cover art for **${info.artist} - ${info.name}**.`);
      const embed = new EmbedBuilder()
        .setTitle(`${info.artist} - ${info.name}`)
        .setURL(info.url)
        .setImage(image);
      return sendable(message).send({ embeds: [embed] });
    } catch (error) {
      if (error instanceof LastfmError && error.notFound) {
        return message.reply(`couldn't find **${artist} - ${album}** on Last.fm.`);
      }
      return message.reply(LASTFM_DOWN_REPLY);
    }
  },
};

export const coverCommands: Command[] = [cover];
