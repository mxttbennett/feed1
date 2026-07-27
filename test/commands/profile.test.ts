import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { profileCommands } from '../../src/commands/profile.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';

const BASE = 'https://ws.audioscrobbler.com';
const byName = (name: string) => profileCommands.find((c) => c.name === name)!;

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

function mockUserInfo(name = 'RJ') {
  nock(BASE)
    .get('/2.0/')
    .query((q) => q.method === 'user.getinfo')
    .reply(200, {
      user: { name, playcount: '100', url: `https://last.fm/user/${name}`, registered: { unixtime: '0' }, image: [] },
    });
}

describe('&login', () => {
  it('registers with the canonical Last.fm capitalization', async () => {
    mockUserInfo('RJ');
    const app = makeFakeApp(profileCommands);
    const fake = makeFakeMessage({ content: '&login rj' });
    await byName('login').run({ app, message: fake.message, args: ['rj'] });

    expect(fake.replies[0]).toContain('your last.fm username `RJ` has been registered');
    const row = app.db.select().from(schema.users).all()[0]!;
    expect(row.lastfmUsername).toBe('RJ');
    expect(row.rymUsername).toBeNull();
  });

  it('stores an rym username when given with the pipe form', async () => {
    mockUserInfo('RJ');
    const app = makeFakeApp(profileCommands);
    const fake = makeFakeMessage({ content: '&login rj | rjrym' });
    await byName('login').run({ app, message: fake.message, args: ['rj', '|', 'rjrym'] });

    expect(fake.replies[0]).toContain('`RJ` & rym username `rjrym`');
    expect(app.db.select().from(schema.users).all()[0]!.rymUsername).toBe('rjrym');
  });

  it('rejects a second login', async () => {
    const app = makeFakeApp(profileCommands);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'x' }).run();
    const fake = makeFakeMessage({ content: '&login rj' });
    await byName('login').run({ app, message: fake.message, args: ['rj'] });
    expect(fake.replies[0]).toContain('you already have logged in');
  });

  it('rejects unknown Last.fm usernames', async () => {
    nock(BASE)
      .get('/2.0/')
      .query(true)
      .reply(404, { error: 6, message: 'User not found' });
    const app = makeFakeApp(profileCommands);
    const fake = makeFakeMessage({ content: '&login nope' });
    await byName('login').run({ app, message: fake.message, args: ['nope'] });
    expect(fake.replies[0]).toBe('`nope` is not a valid last.fm username.');
  });

  it('requires a username argument', async () => {
    const app = makeFakeApp(profileCommands);
    const fake = makeFakeMessage({ content: '&login' });
    await byName('login').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toContain('you must define a last.fm username!');
  });
});

describe('&logout / &mylogin', () => {
  it('deletes the row and reports missing instance after', async () => {
    const app = makeFakeApp(profileCommands);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'x' }).run();

    const first = makeFakeMessage({ content: '&logout' });
    await byName('logout').run({ app, message: first.message, args: [] });
    expect(first.replies[0]).toContain('logged off');
    expect(app.db.select().from(schema.users).all()).toHaveLength(0);

    const second = makeFakeMessage({ content: '&logout' });
    await byName('logout').run({ app, message: second.message, args: [] });
    expect(second.replies[0]).toBe(`your instance hasn't been found.`);
  });

  it('mylogin shows the registered name', async () => {
    const app = makeFakeApp(profileCommands);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'RJ' }).run();
    const fake = makeFakeMessage({ content: '&mylogin' });
    await byName('mylogin').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe('you have logged in as `RJ`.');
  });
});

describe('&plays', () => {
  it('reports scrobble count for a named artist with legacy spacing', async () => {
    nock(BASE)
      .get('/2.0/')
      .query((q) => q.method === 'artist.getinfo')
      .reply(200, {
        artist: { name: 'Autechre', url: '', stats: { listeners: '1', playcount: '1', userplaycount: '99' }, image: [] },
      });
    const app = makeFakeApp(profileCommands);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'x' }).run();
    const fake = makeFakeMessage({ content: '&plays autechre' });
    await byName('plays').run({ app, message: fake.message, args: ['autechre'] });
    expect(fake.replies[0]).toBe('you have scrobbled  `Autechre`  **99** times.');
  });

  it('reports zero-scrobble artists with the legacy wording', async () => {
    nock(BASE)
      .get('/2.0/')
      .query(true)
      .reply(200, {
        artist: { name: 'Nobody', url: '', stats: { listeners: '0', playcount: '0' }, image: [] },
      });
    const app = makeFakeApp(profileCommands);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'x' }).run();
    const fake = makeFakeMessage({ content: '&plays nobody' });
    await byName('plays').run({ app, message: fake.message, args: ['nobody'] });
    expect(fake.replies[0]).toBe("you haven't scrobbled `Nobody`.");
  });
});

describe('&list', () => {
  it('rejects unknown list types with usage help', async () => {
    const app = makeFakeApp(profileCommands);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'x' }).run();
    const fake = makeFakeMessage({ content: '&list nonsense' });
    await byName('list').run({ app, message: fake.message, args: ['nonsense'] });
    expect(fake.replies[0]).toContain('Incorrect usage of a command!');
  });

  it('builds a numbered artist list embed', async () => {
    nock(BASE)
      .get('/2.0/')
      .query((q) => q.method === 'user.gettopartists')
      .reply(200, {
        topartists: {
          artist: [
            { name: 'A', playcount: '10', url: '' },
            { name: 'B', playcount: '5', url: '' },
          ],
          '@attr': { total: '2' },
        },
      });
    mockUserInfo();
    const app = makeFakeApp(profileCommands);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'x' }).run();
    const fake = makeFakeMessage({ content: '&list artists weekly 2' });
    await byName('list').run({ app, message: fake.message, args: ['artists', 'weekly', '2'] });

    const embed = fake.embeds[0] as { data: { description?: string; title?: string } };
    expect(embed.data.description).toBe('1. **A** - 10 plays\n2. **B** - 5 plays');
    expect(embed.data.title).toContain('weekly top 2 artists');
  });
});
