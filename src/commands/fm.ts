import { EmbedBuilder } from 'discord.js';
import type { Message } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { Command, AppContext } from '../core/command.js';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { getRegisteredUser } from '../core/users.js';
import { sendable } from '../core/channel.js';
import { gatherRegisteredMembers } from '../crowns/members.js';
import { notifyCrownChange } from '../crowns/notify.js';
import { CrownService } from '../crowns/service.js';
import { enqueueCrownJob } from '../crowns/worker.js';
import { imageUrl, toInt } from '../lastfm/types.js';
import type { Period, RecentTrack } from '../lastfm/types.js';
import {
  CROWN_GIF_DEFAULT,
  CROWN_GIF_OTHER,
  CROWN_GIF_OWN,
  LASTFM_DOWN_REPLY,
  LOADING_GIF,
  NOT_PLAYING_NOTE,
  escapeAsterisks,
  fmDescription,
  rankLine,
  scrobblesFooter,
  type Ranks,
} from './fmFormat.js';

const PAGE_SIZE = 1000;

interface RankBudget {
  key: keyof Ranks;
  period: Period;
  pages: number;
}

/** pages of 1000 searched per period before giving up on a rank */
const ARTIST_RANK_PAGES: RankBudget[] = [
  { key: 'week', period: '7day', pages: 1 },
  { key: 'month', period: '1month', pages: 1 },
  { key: 'year', period: '12month', pages: 2 },
  { key: 'overall', period: 'overall', pages: 3 },
];

const ALBUM_RANK_PAGES: RankBudget[] = [
  { key: 'week', period: '7day', pages: 1 },
  { key: 'month', period: '1month', pages: 1 },
  { key: 'year', period: '12month', pages: 3 },
  { key: 'overall', period: 'overall', pages: 5 },
];

/**
 * Albums need two fields to identify them; collapse both sides to one comparable key.
 * The NUL joiner can't occur in a name, so "A B" + "C" can't collide with "A" + "B C".
 */
function albumKey(artist: string, album: string): string {
  return `${artist}\u0000${album}`;
}

async function findRank(
  maxPages: number,
  target: string,
  fetchKeys: (page: number) => Promise<string[]>,
): Promise<number | null> {
  const wanted = target.toUpperCase();
  for (let page = 1; page <= maxPages; page++) {
    const keys = await fetchKeys(page);
    if (keys.length === 0) return null;
    const index = keys.findIndex((key) => key.toUpperCase() === wanted);
    if (index !== -1) return (page - 1) * PAGE_SIZE + index + 1;
    if (keys.length < PAGE_SIZE) return null;
  }
  return null;
}

function findArtistRank(
  app: AppContext,
  lastfmUser: string,
  period: Period,
  maxPages: number,
  artist: string,
): Promise<number | null> {
  return findRank(maxPages, artist, async (page) => {
    const data = await app.lastfm.getTopArtists(lastfmUser, period, PAGE_SIZE, page);
    return data.topartists.artist.map((a) => a.name);
  });
}

function findAlbumRank(
  app: AppContext,
  lastfmUser: string,
  period: Period,
  maxPages: number,
  artist: string,
  album: string,
): Promise<number | null> {
  return findRank(maxPages, albumKey(artist, album), async (page) => {
    const data = await app.lastfm.getTopAlbums(lastfmUser, period, PAGE_SIZE, page);
    return data.topalbums.album.map((a) => albumKey(a.artist.name, a.name));
  });
}

/** The footer gif for a settled album crown, or null when the guild has no crown for it yet. */
function albumCrownGif(
  db: Db,
  guildId: string,
  artistName: string,
  albumName: string,
  authorId: string,
): string | null {
  const crown = db
    .select()
    .from(schema.albumCrowns)
    .where(
      and(
        eq(schema.albumCrowns.guildId, guildId),
        eq(schema.albumCrowns.artistName, artistName),
        eq(schema.albumCrowns.albumName, albumName),
      ),
    )
    .get();
  if (!crown) return null;
  return crown.userId === authorId ? CROWN_GIF_OWN : CROWN_GIF_OTHER;
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

    // trails every footer, so a stale track is flagged from the first render onward
    const note = nowPlaying ? '' : NOT_PLAYING_NOTE;
    const withNote = (text: string) => (note ? `${text}\n${note}` : text);

    // phase 1: skeleton embed with the loading footer, edited in place as data arrives
    const embed = baseEmbed(message, lastfmUser, track).setFooter({
      text: withNote('loading your data...'),
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
      // non-null only once Last.fm has told us the album exists, which gates the inline crown scan
      let crownArtist: string | null = null;
      let crownAlbum: string | null = null;

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

          crownArtist = albumData.album.artist;
          crownAlbum = albumData.album.name;
          crownGif =
            albumCrownGif(
              app.db,
              message.guild!.id,
              crownArtist,
              crownAlbum,
              message.author.id,
            ) ?? CROWN_GIF_DEFAULT;
        } catch {
          // no album info → no album segment, default gif
        }
      }

      // legacy &fm recomputed crowns inline; feed1 queues the same work for the background worker.
      // Enqueued before any rendering so a failed edit or rank scan can't cost the guild its
      // crown update.
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

      const foot = scrobblesFooter(allPlays, artistPlays, albumPlays);
      const render = (text: string) =>
        baseEmbed(message, lastfmUser, track).setFooter({ text, iconURL: crownGif });
      await sent.edit({ embeds: [render(withNote(foot))] });

      // phase 2: ranks, revealed one period at a time as each scan finishes
      const artistRanks: Ranks = { week: null, month: null, year: null, overall: null };
      const albumRanks: Ranks = { week: null, month: null, year: null, overall: null };
      const footerWithRanks = () =>
        withNote(foot + rankLine(artistRanks, 'artist') + rankLine(albumRanks, 'album'));
      // a dropped rank edit must not discard the footer we already painted
      const repaint = () =>
        sent.edit({ embeds: [render(footerWithRanks())] }).catch(() => undefined);

      const collect = async (
        ranks: Ranks,
        budget: RankBudget[],
        find: (period: Period, pages: number) => Promise<number | null>,
      ) => {
        for (const { key, period, pages } of budget) {
          try {
            ranks[key] = await find(period, pages);
          } catch {
            ranks[key] = null;
          }
          if (ranks[key] !== null) await repaint();
        }
      };

      if (artistPlays !== null && artistPlays > 0) {
        await collect(artistRanks, ARTIST_RANK_PAGES, (period, pages) =>
          findArtistRank(app, lastfmUser, period, pages, canonicalArtist),
        );
      }

      if (albumPlays !== null && albumPlays > 0 && album) {
        await collect(albumRanks, ALBUM_RANK_PAGES, (period, pages) =>
          findAlbumRank(app, lastfmUser, period, pages, canonicalArtist, canonicalAlbum),
        );
      }

      // phase 3: legacy's inline album crown check, so CROWN_GIF_DEFAULT is a placeholder rather
      // than a permanent answer. Its own try/catch — a failed scan must not discard the footer we
      // already painted, and the queued album job is the retry path.
      if (crownArtist && crownAlbum) {
        try {
          const guild = message.guild!;
          const members = await gatherRegisteredMembers(app.db, guild);
          if (members.length > 0) {
            const service = new CrownService(app.db, app.lastfm, app.guildScanLock, (change) =>
              // the DM is incidental here; losing it must not cost us the icon repaint
              notifyCrownChange(message.client, app.db, change).catch(() => undefined),
            );
            const result = await app.guildScanLock.run(`scan:${guild.id}`, () =>
              service.scan(
                {
                  guildId: guild.id,
                  guildName: guild.name,
                  artistName: crownArtist,
                  albumName: crownAlbum,
                },
                members,
              ),
            );

            // settled inline, so the queued duplicate is waste. Claimed jobs are left for the
            // worker, whose requeue-by-id would otherwise become a silent no-op.
            app.db
              .delete(schema.crownJobs)
              .where(
                and(
                  eq(schema.crownJobs.kind, 'album'),
                  eq(schema.crownJobs.status, 'pending'),
                  eq(schema.crownJobs.guildId, guild.id),
                  eq(schema.crownJobs.artistName, canonicalArtist),
                  eq(schema.crownJobs.albumName, canonicalAlbum),
                ),
              )
              .run();

            // the scan's own canonical names, which need not match the ones we read with above
            const settled = albumCrownGif(
              app.db,
              guild.id,
              result.artistName,
              result.albumName ?? crownAlbum,
              message.author.id,
            );
            if (settled && settled !== crownGif) {
              crownGif = settled;
              await repaint();
            }
          }
        } catch {
          // the queued album job is the fallback, and reports its own failures after retrying
        }
      }
    } catch (error) {
      await app.errors.report(error, 'fm enrichment');
      await sent
        .edit({
          embeds: [
            baseEmbed(message, lastfmUser, track).setFooter({
              text: withNote('could not load your data.'),
              iconURL: CROWN_GIF_DEFAULT,
            }),
          ],
        })
        .catch(() => undefined);
    }
    return undefined;
  },
};
