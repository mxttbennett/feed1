import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { fm } from '../../src/commands/fm.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';
import { LOADING_GIF, CROWN_GIF_OWN, NOT_PLAYING_FOOTER } from '../../src/commands/fmFormat.js';

const BASE = 'https://ws.audioscrobbler.com';

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

function recentTracksBody(nowPlaying: boolean) {
  return {
    recenttracks: {
      track: [
        {
          name: 'Gantz Graf',
          artist: { '#text': 'Autechre', mbid: '' },
          album: { '#text': 'Gantz Graf', mbid: '' },
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

function mockLastfm(nowPlaying = true) {
  nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'user.getrecenttracks')
    .reply(200, recentTracksBody(nowPlaying));
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
      artist: { name: 'Autechre', url: '', stats: { listeners: '1', playcount: '1', userplaycount: '250' }, image: [] },
    });
  nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'album.getinfo')
    .reply(200, {
      album: { name: 'Gantz Graf', artist: 'Autechre', url: '', userplaycount: 42, image: [] },
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

describe('&fm', () => {
  it('requires login', async () => {
    const app = makeFakeApp([fm]);
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(app.snippets.noLogin);
  });

  it('renders loading embed first, then edits in the full footer and ranks', async () => {
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

    // phase 2 + 3 edits
    expect(fake.edits.length).toBeGreaterThanOrEqual(2);
    expect(footerOf(fake.edits[0])).toBe('scrobbles → all: 5000 | artist: 250 | album: 42');
    expect(footerOf(fake.edits[1])).toBe(
      'scrobbles → all: 5000 | artist: 250 | album: 42' +
        '\nalbum ranks → w: #1 | m: #1 | y: #1 | o: #1',
    );
  });

  it('enqueues artist and album crown jobs instead of scanning inline', async () => {
    mockLastfm();
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });

    const jobs = app.db.select().from(schema.crownJobs).all();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.kind).sort()).toEqual(['album', 'artist']);
    expect(jobs.every((j) => j.artistName === 'Autechre')).toBe(true);
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

  it('falls back to last scrobbled with the legacy footer text', async () => {
    mockLastfm(false);
    const app = setup();
    const fake = makeFakeMessage({ content: '&fm' });
    await fm.run({ app, message: fake.message, args: [] });
    expect(footerOf(fake.edits[0])).toContain(NOT_PLAYING_FOOTER);
    expect(footerOf(fake.edits[0])).toContain('scrobbles → all: 5000');
  });
});
