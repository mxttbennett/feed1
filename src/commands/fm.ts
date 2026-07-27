import { EmbedBuilder } from 'discord.js';
import type { Message } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { Command, AppContext } from '../core/command.js';
import { schema } from '../db/index.js';
import { getRegisteredUser } from '../core/users.js';
import { sendable } from '../core/channel.js';
import { enqueueCrownJob } from '../crowns/worker.js';
import { imageUrl, toInt } from '../lastfm/types.js';
import type { Period, RecentTrack } from '../lastfm/types.js';
import {
  CROWN_GIF_DEFAULT,
  CROWN_GIF_OTHER,
  CROWN_GIF_OWN,
  LASTFM_DOWN_REPLY,
  LOADING_GIF,
  NOT_PLAYING_FOOTER,
  escapeAsterisks,
  fmDescription,
  rankLine,
  scrobblesFooter,
  type AlbumRanks,
} from './fmFormat.js';

/** pages of 1000 searched per period before giving up on a rank */
const RANK_PAGES: { key: keyof AlbumRanks; period: Period; pages: number }[] = [
  { key: 'week', period: '7day', pages: 1 },
  { key: 'month', period: '1month', pages: 1 },
  { key: 'year', period: '12month', pages: 3 },
  { key: 'overall', period: 'overall', pages: 5 },
];

async function findAlbumRank(
  app: AppContext,
  lastfmUser: string,
  period: Period,
  maxPages: number,
  artist: string,
  album: string,
): Promise<number | null> {
  for (let page = 1; page <= maxPages; page++) {
    const data = await app.lastfm.getTopAlbums(lastfmUser, period, 1000, page);
    const albums = data.topalbums.album;
    if (albums.length === 0) return null;
    const index = albums.findIndex(
      (a) =>
        a.artist.name.toUpperCase() === artist.toUpperCase() &&
        a.name.toUpperCase() === album.toUpperCase(),
    );
    if (index !== -1) return (page - 1) * 1000 + index + 1;
    if (albums.length < 1000) return null;
  }
  return null;
}

function baseEmbed(message: Message, lastfmUser: string, track: RecentTrack): EmbedBuilder {
  const artist = track.artist['#text'];
  const album = track.album['#text'];
  return new EmbedBuilder()
    .setColor(message.member?.displayColor ?? null)
    .setAuthor({
      name: message.author.username,
      iconURL: message.author.displayAvatarURL(),
      url: `https://www.last.fm/user/${lastfmUser}`,
    })
    .setTitle(`**${escapeAsterisks(track.name)}**`)
    .setDescription(fmDescription(artist, album))
    .setThumbnail(imageUrl(track.image, 2) || null);
}

export const fm: Command = {
  name: 'fm',
  aliases: ['f'],
  description:
    'Posts the song you are listening to right now or the last one scrobbled if no currently ' +
    'playing song is detected on last.fm.',
  usage: 'fm',
  guildOnly: true,
  async run({ app, message }) {
    const registered = getRegisteredUser(app.db, message.author.id);
    if (!registered) return message.reply(app.snippets.noLogin);
    const lastfmUser = registered.lastfmUsername;

    let track: RecentTrack;
    let nowPlaying = true;
    try {
      const recents = await app.lastfm.getRecentTracks(lastfmUser, { limit: 1 });
      const first = recents.recenttracks.track[0];
      if (!first) return message.reply(app.snippets.notPlaying);
      track = first;
      nowPlaying = Boolean(first['@attr']?.nowplaying);
    } catch {
      return message.reply(LASTFM_DOWN_REPLY);
    }

    const artist = track.artist['#text'];
    const album = track.album['#text'];

    // phase 1: skeleton embed with the loading footer, edited in place as data arrives
    const embed = baseEmbed(message, lastfmUser, track).setFooter({
      text: 'loading your data...',
      iconURL: LOADING_GIF,
    });
    const sent = await sendable(message).send({ embeds: [embed] });

    try {
      const userData = await app.lastfm.getUserInfo(lastfmUser);
      const allPlays = toInt(userData.user.playcount);

      let artistPlays: number | null = null;
      let albumPlays: number | null = null;
      let canonicalArtist = artist;
      let canonicalAlbum = album;
      let crownGif = CROWN_GIF_DEFAULT;

      try {
        const artistData = await app.lastfm.getArtistInfo(artist, lastfmUser);
        artistPlays = toInt(artistData.artist.stats.userplaycount);
        canonicalArtist = artistData.artist.name;
      } catch {
        // artist lookup failing just drops the segment, like legacy
      }

      if (album) {
        try {
          const albumData = await app.lastfm.getAlbumInfo(artist, album, lastfmUser);
          albumPlays = toInt(albumData.album.userplaycount);
          canonicalAlbum = albumData.album.name;

          const crown = app.db
            .select()
            .from(schema.albumCrowns)
            .where(
              and(
                eq(schema.albumCrowns.guildId, message.guild!.id),
                eq(schema.albumCrowns.artistName, albumData.album.artist),
                eq(schema.albumCrowns.albumName, albumData.album.name),
              ),
            )
            .get();
          if (crown) {
            crownGif = crown.userId === message.author.id ? CROWN_GIF_OWN : CROWN_GIF_OTHER;
          }
        } catch {
          // no album info → no album segment, default gif
        }
      }

      let foot = scrobblesFooter(allPlays, artistPlays, albumPlays);
      if (!nowPlaying) foot = `${NOT_PLAYING_FOOTER}\n${foot}`;
      await sent.edit({
        embeds: [baseEmbed(message, lastfmUser, track).setFooter({ text: foot, iconURL: crownGif })],
      });

      // phase 2: album ranks, appended once found
      if (albumPlays !== null && albumPlays > 0 && album) {
        const ranks: AlbumRanks = { week: null, month: null, year: null, overall: null };
        for (const { key, period, pages } of RANK_PAGES) {
          try {
            ranks[key] = await findAlbumRank(
              app,
              lastfmUser,
              period,
              pages,
              canonicalArtist,
              canonicalAlbum,
            );
          } catch {
            ranks[key] = null;
          }
        }
        const line = rankLine(ranks);
        if (line) {
          await sent.edit({
            embeds: [
              baseEmbed(message, lastfmUser, track).setFooter({
                text: foot + line,
                iconURL: crownGif,
              }),
            ],
          });
        }
      }

      // legacy &fm recomputed crowns inline; feed1 queues the same work for the background worker
      if (message.guild) {
        enqueueCrownJob(app.db, {
          kind: 'artist',
          guildId: message.guild.id,
          artistName: canonicalArtist,
          requestedBy: message.author.id,
        });
        if (album) {
          enqueueCrownJob(app.db, {
            kind: 'album',
            guildId: message.guild.id,
            artistName: canonicalArtist,
            albumName: canonicalAlbum,
            requestedBy: message.author.id,
          });
        }
      }
    } catch (error) {
      await app.errors.report(error, 'fm enrichment');
      await sent
        .edit({
          embeds: [
            baseEmbed(message, lastfmUser, track).setFooter({
              text: nowPlaying ? 'could not load your data.' : NOT_PLAYING_FOOTER,
              iconURL: CROWN_GIF_DEFAULT,
            }),
          ],
        })
        .catch(() => undefined);
    }
    return undefined;
  },
};
