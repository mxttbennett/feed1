import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { coverCommands } from '../../src/commands/cover.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';

const BASE = 'https://ws.audioscrobbler.com';
const CDN = 'https://lastfm.freetls.fastly.net/i/u';
const cover = coverCommands[0]!;

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

const albumBody = (image: { size: string; '#text': string }[]) => ({
  album: {
    name: 'Confield',
    artist: 'Autechre',
    url: 'https://www.last.fm/music/Autechre/Confield',
    image,
  },
});

const IMAGES = [
  { size: 'small', '#text': `${CDN}/34s/abc.png` },
  { size: 'large', '#text': `${CDN}/174s/abc.png` },
  { size: 'extralarge', '#text': `${CDN}/300x300/abc.png` },
];

function mockAlbum(body: unknown, status = 200) {
  nock(BASE)
    .get('/2.0/')
    .query((q) => q.method === 'album.getinfo' && q.artist === 'Autechre' && q.album === 'Confield')
    .reply(status, body as object);
}

describe('&cover', () => {
  it('sends the original-size image for an explicit album', async () => {
    mockAlbum(albumBody(IMAGES));
    const fake = makeFakeMessage({ content: '&cover' });
    await cover.run({
      app: makeFakeApp(),
      message: fake.message,
      args: ['Autechre', '|', 'Confield'],
    });

    const embed = fake.embeds[0] as EmbedBuilder;
    expect(embed.data.title).toBe('Autechre - Confield');
    expect(embed.data.image?.url).toBe(`${CDN}/abc.png`);
  });

  it('uses the now playing album with no arguments', async () => {
    nock(BASE)
      .get('/2.0/')
      .query((q) => q.method === 'user.getrecenttracks')
      .reply(200, {
        recenttracks: {
          track: [
            {
              name: 'VI Scose Poise',
              artist: { '#text': 'Autechre', mbid: '' },
              album: { '#text': 'Confield', mbid: '' },
              image: [],
              url: '',
            },
          ],
          '@attr': { total: '1', user: 'lfm1' },
        },
      });
    mockAlbum(albumBody(IMAGES));
    const app = makeFakeApp();
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'lfm1' }).run();
    const fake = makeFakeMessage({ content: '&cover' });
    await cover.run({ app, message: fake.message, args: [] });

    expect((fake.embeds[0] as EmbedBuilder).data.image?.url).toBe(`${CDN}/abc.png`);
  });

  it('asks for both parts when the album is missing', async () => {
    const fake = makeFakeMessage({ content: '&cover Autechre' });
    await cover.run({ app: makeFakeApp(), message: fake.message, args: ['Autechre'] });
    expect(fake.embeds).toHaveLength(0);
    expect(fake.replies[0]).toContain('artist | album');
  });

  it('says so when Last.fm has no cover', async () => {
    mockAlbum(albumBody([]));
    const fake = makeFakeMessage({ content: '&cover' });
    await cover.run({
      app: makeFakeApp(),
      message: fake.message,
      args: ['Autechre', '|', 'Confield'],
    });
    expect(fake.replies[0]).toContain('no cover art');
  });
});
