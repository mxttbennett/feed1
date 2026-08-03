import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { fm } from '../../src/commands/fm.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage, withGuildMembers } from '../helpers/fake.js';
import {
  LOADING_GIF,
  CROWN_GIF_DEFAULT,
  CROWN_GIF_OTHER,
  CROWN_GIF_OWN,
  NOT_PLAYING_NOTE,
} from '../../src/commands/fmFormat.js';

const BASE = 'https://ws.audioscrobbler.com';

const SCROBBLES = 'scrobbles → all: 5000 | artist: 250 | album: 42';
const ARTIST_RANKS = '\nartist ranks → w: #1 | m: #1 | y: #1 | o: #1';
const ALBUM_RANKS = '\nalbum ranks → w: #1 | m: #1 | y: #1 | o: #1';

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

function recentTracksBody(nowPlaying: boolean, album = 'Gantz Graf') {
  return {
    recenttracks: {
      track: [
        {
          name: 'Gantz Graf',
          artist: { '#text': 'Autechre', mbid: '' },
          album: { '#text': album, mbid: '' },
          image: [
            { size: 'small', '#text': 'https://img.example/s.png' },
            { size: 'medium', '#text': 'https://img.example/m.png' },
            { size: 'large', '#text': 'https://img.example/l.png' },
            { size: 'extralarge', '#text': 'https://img.example/xl.png' },
          ],
          url: 'https://www.last.fm/music/Autechre/_/Gantz+Graf',
          ...(nowPlaying ? { '@attr': { nowplaying: 'true' } } : {}),
        },
      ],
      '@attr': { total: '1', user: 'lfm1' },
    },
  };
}

interface MockOptions {
  nowPlaying?: boolean;
  /** '' simulates a scrobble with no album */
  album?: string;
  artistPlays?: string;
  albumPlays?: number;
  /** per-last.fm-username album plays for the crown fan-out; others get `albumPlays` */
  albumPlaysByUser?: Record<string, number>;
  /** make user.gettopartists fail so only album ranks can resolve */
  topArtistsDown?: boolean;
  /** make album.getinfo fail for everyone but the caller, sinking the crown scan */
  albumScanDown?: boolean;
}

function mockLastfm(opts: MockOptions = {}) {
  const {
    nowPlaying = true,
    album = 'Gantz Graf',
    artistPlays = '250',
    albumPlays = 42,
    albumPlaysByUser = {},
    topArtistsDown = false,
    albumScanDown = false,
  } = opts;

  nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'user.getrecenttracks')
    .reply(200, recentTracksBody(nowPlaying, album));
  nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'user.getinfo')
    .reply(200, { user: { name: 'lfm1', playcount: '5000', url: '', registered: { unixtime: '0' }, image: [] } });
  nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'artist.getinfo')
    .reply(200, {
      artist: {
        name: 'Autechre',
        url: '',
        stats: { listeners: '1', playcount: '1', userplaycount: artistPlays },
        image: [],
      },
    });
  // one username-aware interceptor: nock matches in registration order, so a second
  // album.getinfo mock added by a test would never be reached
  nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'album.getinfo')
    .reply((uri) => {
      const username = new URL(`https://x${uri}`).searchParams.get('username') ?? '';
      if (albumScanDown && username !== 'lfm1') return [500, {}];
      return [
        200,
        {
          album: {
            name: 'Gantz Graf',
            artist: 'Autechre',
            url: '',
            userplaycount: albumPlaysByUser[username] ?? albumPlays,
            image: [],
          },
        },
      ];
    });
  nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'user.gettopalbums')
    .reply(200, {
      topalbums: {
        album: [
          {
            name: 'Gantz Graf',
            playcount: '42',
            artist: { name: 'Autechre', url: '' },
            image: [],
            url: '',
          },
        ],
        '@attr': { total: '1' },
      },
    });

  const topArtists = nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'user.gettopartists');
  if (topArtistsDown) topArtists.reply(500, {});
  else
    topArtists.reply(200, {
      topartists: {
        artist: [{ name: 'Autechre', playcount: '250', url: '' }],
        '@attr': { total: '1' },
      },
    });
}

function setup() {
  const app = makeFakeApp([fm]);
  app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'lfm1' }).run();
  return app;
}

function footerOf(edit: unknown): string {
  const embeds = (edit as { embeds: EmbedBuilder[] }).embeds;
  return embeds[0]!.data.footer?.text ?? '';
}

function footerIconOf(edit: unknown): string {
  const embeds = (edit as { embeds: EmbedBuilder[] }).embeds;
  return embeds[0]!.data.footer?.icon_url ?? '';
}

function lastFooter(edits: unknown[]): string {
  return footerOf(edits[edits.length - 1]);
}

describe('&fm', () => {
  it('requires login', async () => {
    const app = makeFakeApp([fm]);
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(app.snippets.noLogin);
  });

  it('renders loading embed first, then reveals ranks one period at a time', async () => {
    mockLastfm();
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });

    // phase 1: loading footer
    const first = fake.embeds[0] as EmbedBuilder;
    expect(first.data.footer?.text).toBe('loading your data...');
    expect(first.data.footer?.icon_url).toBe(LOADING_GIF);
    expect(first.data.title).toBe('**Gantz Graf**');
    expect(first.data.description).toContain('[***Gantz Graf***](');

    // one edit for the scrobbles footer, then one per resolved rank period
    expect(fake.edits).toHaveLength(9);
    expect(footerOf(fake.edits[0])).toBe(SCROBBLES);
    expect(footerOf(fake.edits[1])).toBe(`${SCROBBLES}\nartist ranks → w: #1`);
    expect(footerOf(fake.edits[2])).toBe(`${SCROBBLES}\nartist ranks → w: #1 | m: #1`);
    expect(footerOf(fake.edits[4])).toBe(SCROBBLES + ARTIST_RANKS);
    expect(footerOf(fake.edits[5])).toBe(`${SCROBBLES + ARTIST_RANKS}\nalbum ranks → w: #1`);
    expect(lastFooter(fake.edits)).toBe(SCROBBLES + ARTIST_RANKS + ALBUM_RANKS);
  });

  it('shows artist ranks on a scrobble with no album', async () => {
    mockLastfm({ album: '' });
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });

    const footer = lastFooter(fake.edits);
    expect(footer).toBe('scrobbles → all: 5000 | artist: 250' + ARTIST_RANKS);
    expect(footer).not.toContain('album ranks');
  });

  it('shows no rank lines when the user has no plays for the artist or album', async () => {
    mockLastfm({ artistPlays: '0', albumPlays: 0 });
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });

    expect(fake.edits).toHaveLength(1);
    expect(footerOf(fake.edits[0])).toBe('scrobbles → all: 5000');
  });

  it('keeps the album rank line when the artist rank lookup fails', async () => {
    mockLastfm({ topArtistsDown: true });
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });

    const footer = lastFooter(fake.edits);
    expect(footer).toBe(SCROBBLES + ALBUM_RANKS);
    expect(footer).not.toContain('artist ranks');
    expect(footer).not.toContain('could not load your data.');
  });

  it('survives a dropped rank edit and still paints the final footer', async () => {
    mockLastfm();
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm', failEditsAt: [1] });
    await fm.run({ app, message: fake.message, args: [] });

    expect(lastFooter(fake.edits)).toBe(SCROBBLES + ARTIST_RANKS + ALBUM_RANKS);
    expect(app.reportedErrors).toHaveLength(0);
  });

  it('enqueues artist and album crown jobs before rendering', async () => {
    mockLastfm();
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });

    const jobs = app.db.select().from(schema.crownJobs).all();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.kind).sort()).toEqual(['album', 'artist']);
    expect(jobs.every((j) => j.artistName === 'Autechre')).toBe(true);
  });

  it('still enqueues crown jobs when the footer edit fails', async () => {
    mockLastfm();
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm', failEditsAt: [0] });
    await fm.run({ app, message: fake.message, args: [] });

    expect(app.db.select().from(schema.crownJobs).all()).toHaveLength(2);
    expect(lastFooter(fake.edits)).toBe('could not load your data.');
  });

  it('shows the own-crown gif when the caller holds the album crown', async () => {
    mockLastfm();
    const app = setup();
    app.db
      .insert(schema.albumCrowns)
      .values({
        guildId: 'guild-1',
        userId: 'user-1',
        artistName: 'Autechre',
        albumName: 'Gantz Graf',
        albumPlays: 42,
      })
      .run();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });
    expect(footerIconOf(fake.edits[0])).toBe(CROWN_GIF_OWN);
  });

  it('flags a last-scrobbled track from the first render, with the note last', async () => {
    mockLastfm({ nowPlaying: false });
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });

    // the note is known before any Last.fm enrichment, so it ships with the loading embed
    const first = fake.embeds[0] as EmbedBuilder;
    expect(first.data.footer?.text).toBe(`loading your data...\n${NOT_PLAYING_NOTE}`);

    expect(footerOf(fake.edits[0])).toBe(`${SCROBBLES}\n${NOT_PLAYING_NOTE}`);
    expect(lastFooter(fake.edits)).toBe(
      `${SCROBBLES + ARTIST_RANKS + ALBUM_RANKS}\n${NOT_PLAYING_NOTE}`,
    );
  });

  it('keeps the note below the failure message when enrichment fails', async () => {
    mockLastfm({ nowPlaying: false });
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm', failEditsAt: [0] });
    await fm.run({ app, message: fake.message, args: [] });

    expect(lastFooter(fake.edits)).toBe(`could not load your data.\n${NOT_PLAYING_NOTE}`);
  });

  it('shows no note at all while a track is playing', async () => {
    mockLastfm();
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });

    expect((fake.embeds[0] as EmbedBuilder).data.footer?.text).toBe('loading your data...');
    expect(lastFooter(fake.edits)).not.toContain(NOT_PLAYING_NOTE);
  });
});

describe('&fm inline album crown', () => {
  /** the caller plus one rival, both registered so the member join keeps them */
  function setupWithMembers(opts: { fetchUser?: (id: string) => Promise<unknown> } = {}) {
    const app = makeFakeApp([fm]);
    app.db
      .insert(schema.users)
      .values([
        { discordUserId: 'user-1', lastfmUsername: 'lfm1' },
        { discordUserId: 'user-2', lastfmUsername: 'lfm2' },
      ])
      .run();
    const fake = makeFakeMessage({ content: '&fm', ...opts });
    withGuildMembers(fake, ['user-1', 'user-2']);
    return { app, fake };
  }

  function lastIcon(edits: unknown[]): string {
    return footerIconOf(edits[edits.length - 1]);
  }

  function insertCrown(app: ReturnType<typeof makeFakeApp>, userId: string, albumPlays: number) {
    app.db
      .insert(schema.albumCrowns)
      .values({
        guildId: 'guild-1',
        userId,
        artistName: 'Autechre',
        albumName: 'Gantz Graf',
        albumPlays,
      })
      .run();
  }

  it('replaces the placeholder gif with the own-crown gif once the scan settles', async () => {
    mockLastfm({ albumPlaysByUser: { lfm2: 5 } });
    const { app, fake } = setupWithMembers();
    await fm.run({ app, message: fake.message, args: [] });

    expect(footerIconOf(fake.edits[0])).toBe(CROWN_GIF_DEFAULT);
    expect(lastIcon(fake.edits)).toBe(CROWN_GIF_OWN);
    // the footer text survives the repaint untouched
    expect(lastFooter(fake.edits)).toBe(SCROBBLES + ARTIST_RANKS + ALBUM_RANKS);

    const crown = app.db.select().from(schema.albumCrowns).all()[0]!;
    expect(crown.userId).toBe('user-1');
    expect(crown.albumPlays).toBe(42);
  });

  it('shows the other-crown gif when another member holds the album', async () => {
    mockLastfm({ albumPlaysByUser: { lfm2: 500 } });
    const { app, fake } = setupWithMembers();
    await fm.run({ app, message: fake.message, args: [] });

    expect(footerIconOf(fake.edits[0])).toBe(CROWN_GIF_DEFAULT);
    expect(lastIcon(fake.edits)).toBe(CROWN_GIF_OTHER);
    expect(app.db.select().from(schema.albumCrowns).all()[0]!.userId).toBe('user-2');
  });

  it('spends no extra edit when the scan confirms the gif already shown', async () => {
    mockLastfm({ albumPlaysByUser: { lfm2: 5 } });
    const { app, fake } = setupWithMembers();
    insertCrown(app, 'user-1', 42);
    await fm.run({ app, message: fake.message, args: [] });

    expect(footerIconOf(fake.edits[0])).toBe(CROWN_GIF_OWN);
    expect(lastIcon(fake.edits)).toBe(CROWN_GIF_OWN);
    // same count as a run with no crown scan at all — the change guard held
    expect(fake.edits).toHaveLength(9);
  });

  it('drops the redundant album job but leaves the artist job queued', async () => {
    mockLastfm({ albumPlaysByUser: { lfm2: 5 } });
    const { app, fake } = setupWithMembers();
    await fm.run({ app, message: fake.message, args: [] });

    const jobs = app.db.select().from(schema.crownJobs).all();
    expect(jobs.map((j) => j.kind)).toEqual(['artist']);
  });

  it('keeps the finished footer when the crown fan-out fails', async () => {
    mockLastfm({ albumScanDown: true });
    const { app, fake } = setupWithMembers();
    await fm.run({ app, message: fake.message, args: [] });

    const footer = lastFooter(fake.edits);
    expect(footer).toBe(SCROBBLES + ARTIST_RANKS + ALBUM_RANKS);
    expect(footer).not.toContain('could not load your data.');
    expect(lastIcon(fake.edits)).toBe(CROWN_GIF_DEFAULT);
    // both jobs survive, so the worker still gets to settle the crown
    expect(app.db.select().from(schema.crownJobs).all()).toHaveLength(2);
    expect(app.reportedErrors).toHaveLength(0);
  });

  it('notifies both sides when the caller takes the crown, and still repaints', async () => {
    mockLastfm({ albumPlaysByUser: { lfm2: 5 } });
    const dms: string[] = [];
    const { app, fake } = setupWithMembers({
      fetchUser: (id) =>
        Promise.resolve({
          tag: `${id}#0`,
          send: (text: string) => {
            dms.push(`${id}: ${text}`);
            return Promise.resolve();
          },
        }),
    });
    insertCrown(app, 'user-2', 5);
    app.db
      .insert(schema.notifPrefs)
      .values([
        { userId: 'user-1', onWin: true },
        { userId: 'user-2', onLoss: true },
      ])
      .run();

    await fm.run({ app, message: fake.message, args: [] });

    expect(dms.some((d) => d.startsWith('user-1:') && d.includes('have won'))).toBe(true);
    expect(dms.some((d) => d.startsWith('user-2:') && d.includes('have lost'))).toBe(true);
    expect(lastIcon(fake.edits)).toBe(CROWN_GIF_OWN);
  });

  it('still repaints when the notification path throws', async () => {
    mockLastfm({ albumPlaysByUser: { lfm2: 5 } });
    const { app, fake } = setupWithMembers({
      fetchUser: () => {
        throw new Error('users unavailable');
      },
    });
    insertCrown(app, 'user-2', 5);

    await fm.run({ app, message: fake.message, args: [] });

    // the DM throw is swallowed, so the caller's takeover still reaches the footer
    expect(footerIconOf(fake.edits[0])).toBe(CROWN_GIF_OTHER);
    expect(lastIcon(fake.edits)).toBe(CROWN_GIF_OWN);
    expect(app.db.select().from(schema.albumCrowns).all()[0]!.userId).toBe('user-1');
  });

  it('skips the scan for a scrobble with no album', async () => {
    mockLastfm({ album: '' });
    const { app, fake } = setupWithMembers();
    await fm.run({ app, message: fake.message, args: [] });

    expect(lastIcon(fake.edits)).toBe(CROWN_GIF_DEFAULT);
    expect(app.db.select().from(schema.albumCrowns).all()).toHaveLength(0);
  });

  it('skips the scan when nobody in the guild is registered', async () => {
    mockLastfm();
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });

    expect(lastIcon(fake.edits)).toBe(CROWN_GIF_DEFAULT);
    expect(app.db.select().from(schema.albumCrowns).all()).toHaveLength(0);
    expect(app.db.select().from(schema.crownJobs).all()).toHaveLength(2);
  });
});
