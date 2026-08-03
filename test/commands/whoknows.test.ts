import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { whoKnowsCommands } from '../../src/commands/whoknows.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage, type FakeMessage } from '../helpers/fake.js';
import { Collection } from 'discord.js';
import type { Message } from 'discord.js';

const BASE = 'https://ws.audioscrobbler.com';
const byName = (name: string) => whoKnowsCommands.find((c) => c.name === name)!;

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

/** two registered members whose artist playcounts differ */
function mockArtistScan(plays: Record<string, string>) {
  nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'artist.getinfo')
    .reply(200, (uri) => {
      const username = new URL(`https://x${uri}`).searchParams.get('username')!;
      return {
        artist: {
          name: 'Autechre',
          url: 'https://last.fm/music/Autechre',
          stats: { listeners: '2', playcount: '100', userplaycount: plays[username] ?? '0' },
          image: [],
        },
      };
    });
}

function mockRecentTracks(opts: { nowPlaying?: boolean; empty?: boolean } = {}) {
  const track = {
    name: 'Gantz Graf',
    artist: { '#text': 'Autechre', mbid: '' },
    album: { '#text': 'Gantz Graf', mbid: '' },
    image: [],
    url: '',
    ...(opts.nowPlaying ? { '@attr': { nowplaying: 'true' } } : {}),
  };
  nock(BASE)
    .persist()
    .get('/2.0/')
    .query((q) => q.method === 'user.getrecenttracks')
    .reply(200, {
      recenttracks: {
        track: opts.empty ? [] : [track],
        '@attr': { total: opts.empty ? '0' : '1', user: 'lfm1' },
      },
    });
}

function guildWithMembers(fake: FakeMessage, ids: string[]) {
  const collection = new Collection(
    ids.map((id) => [id, { user: { id, bot: false, tag: `${id}#0`, username: id } }]),
  );
  const cache = new Collection<string, unknown>();
  const members = {
    cache,
    fetch: () => {
      for (const [id, m] of collection) cache.set(id, m);
      return Promise.resolve(collection);
    },
  };
  (
    fake.message as unknown as {
      guild: { id: string; name: string; members: unknown; memberCount: number };
    }
  ).guild = {
    id: 'guild-1',
    name: 'Test Guild',
    members,
    memberCount: ids.length,
  };
}

function setup(plays: Record<string, string>) {
  const app = makeFakeApp(whoKnowsCommands);
  app.db
    .insert(schema.users)
    .values([
      { discordUserId: 'user-1', lastfmUsername: 'lfm1' },
      { discordUserId: 'user-2', lastfmUsername: 'lfm2' },
    ])
    .run();
  mockArtistScan(plays);
  const fake = makeFakeMessage({ content: '&wk autechre' });
  guildWithMembers(fake, ['user-1', 'user-2']);
  return { app, fake };
}

describe('&wk', () => {
  it('ranks listeners, writes the crown, and shows the legacy line format', async () => {
    const { app, fake } = setup({ lfm1: '10', lfm2: '40' });
    await byName('wk').run({ app, message: fake.message, args: ['autechre'] });

    const embed = fake.embeds[0] as EmbedBuilder;
    const desc = embed.data.description!;
    expect(desc).toContain('1. user-2 → **40** scrobbles (80%)');
    expect(desc).toContain('2. user-1 → **10** scrobbles (20%)');
    expect(embed.data.title).toBe('Autechre');
    expect(embed.data.footer?.text).toContain('50 scrobbles | 2 listeners | 25 avg');
    expect(embed.data.footer?.text).toContain('this crown check took');

    const crown = app.db.select().from(schema.crowns).all()[0]!;
    expect(crown.userId).toBe('user-2');
    expect(crown.artistPlays).toBe(40);
  });

  it('filters zero-play members out of the list', async () => {
    const { app, fake } = setup({ lfm1: '10', lfm2: '0' });
    await byName('wk').run({ app, message: fake.message, args: ['autechre'] });
    const desc = (fake.embeds[0] as EmbedBuilder).data.description!;
    expect(desc).toContain('user-1');
    expect(desc).not.toContain('user-2');
  });

  it('requires login', async () => {
    const app = makeFakeApp(whoKnowsCommands);
    const fake = makeFakeMessage({ content: '&wk x' });
    await byName('wk').run({ app, message: fake.message, args: ['x'] });
    expect(fake.replies[0]).toBe(app.snippets.noLogin);
  });

  it('falls back to the last scrobbled track when nothing is playing', async () => {
    const { app, fake } = setup({ lfm1: '10', lfm2: '40' });
    mockRecentTracks({ nowPlaying: false });
    await byName('wk').run({ app, message: fake.message, args: [] });

    // resolved the artist from the last scrobble instead of bailing out
    expect(fake.replies).not.toContain(app.snippets.notPlaying);
    expect((fake.embeds[0] as EmbedBuilder).data.title).toBe('Autechre');
  });

  it('bails only when the user has never scrobbled anything', async () => {
    const { app, fake } = setup({ lfm1: '10' });
    mockRecentTracks({ empty: true });
    await byName('wk').run({ app, message: fake.message, args: [] });

    expect(fake.replies[0]).toBe(app.snippets.notPlaying);
    expect(fake.embeds).toHaveLength(0);
  });
});

describe('&a', () => {
  it('parses the artist | album argument form and writes an album crown', async () => {
    const app = makeFakeApp(whoKnowsCommands);
    app.db
      .insert(schema.users)
      .values([{ discordUserId: 'user-1', lastfmUsername: 'lfm1' }])
      .run();
    nock(BASE)
      .persist()
      .get('/2.0/')
      .query((q) => q.method === 'album.getinfo')
      .reply(200, {
        album: {
          name: 'Confield',
          artist: 'Autechre',
          url: 'https://last.fm/music/Autechre/Confield',
          userplaycount: 12,
          image: [
            { size: 'small', '#text': '' },
            { size: 'medium', '#text': '' },
            { size: 'large', '#text': 'https://img.example/l.png' },
          ],
        },
      });

    const fake = makeFakeMessage({ content: '&a Autechre | Confield' });
    guildWithMembers(fake, ['user-1']);
    await byName('a').run({ app, message: fake.message, args: ['Autechre', '|', 'Confield'] });

    const embed = fake.embeds[0] as EmbedBuilder;
    expect(embed.data.title).toBe('*Confield*');
    expect(embed.data.author?.name).toBe('Autechre');
    expect(app.db.select().from(schema.albumCrowns).all()[0]!.albumName).toBe('Confield');
  });

  it('rejects album args without the pipe separator', async () => {
    const app = makeFakeApp(whoKnowsCommands);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'lfm1' }).run();
    const fake = makeFakeMessage({ content: '&a Confield' });
    await byName('a').run({ app, message: fake.message, args: ['Confield'] });
    expect(fake.replies[0]).toContain('<artist> | <album>');
  });
});

describe('message shape', () => {
  it('fake messages satisfy the Message surface the commands touch', () => {
    const fake = makeFakeMessage({ content: 'x' });
    const m: Message = fake.message;
    expect(m.content).toBe('x');
  });
});
