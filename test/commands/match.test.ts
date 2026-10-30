import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { matchCommands } from '../../src/commands/match.js';
import { buildProfile, compare } from '../../src/commands/matchFormat.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage, withGuildMembers } from '../helpers/fake.js';

const BASE = 'https://ws.audioscrobbler.com';
const match = matchCommands[0]!;

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

const top = (...entries: [string, number][]) =>
  entries.map(([name, plays]) => ({ name, playcount: String(plays), url: '' }));

describe('compare', () => {
  it('scores identical taste at 100 and disjoint taste at 0', () => {
    const a = buildProfile('a', top(['Autechre', 100], ['Boards of Canada', 50]));
    expect(
      compare(a, buildProfile('b', top(['Autechre', 100], ['Boards of Canada', 50]))).score,
    ).toBeCloseTo(100);
    expect(compare(a, buildProfile('c', top(['Slayer', 100]))).score).toBe(0);
  });

  it('matches artist names regardless of case and lists the strongest overlap first', () => {
    const a = buildProfile('a', top(['Autechre', 400], ['Aphex Twin', 9]));
    const b = buildProfile('b', top(['aphex twin', 9], ['AUTECHRE', 400]));
    expect(compare(a, b).shared).toEqual(['Autechre', 'Aphex Twin']);
  });

  it('scores an empty profile at 0 rather than NaN', () => {
    expect(compare(buildProfile('a', []), buildProfile('b', top(['X', 1]))).score).toBe(0);
  });
});

function mockTop(user: string, artists: ReturnType<typeof top> | 'private') {
  nock(BASE)
    .get('/2.0/')
    .query((q) => q.method === 'user.gettopartists' && q.user === user)
    .reply(
      200,
      artists === 'private'
        ? { error: 17, message: 'Login: User required to be logged in' }
        : { topartists: { artist: artists, '@attr': { total: '1' } } },
    );
}

describe('&taste', () => {
  it('is named taste with match and twin as aliases', () => {
    expect(match.name).toBe('taste');
    expect(match.aliases).toEqual(['match', 'twin']);
  });

  it('requires login', async () => {
    const app = makeFakeApp([match]);
    const fake = makeFakeMessage({ content: '&taste' });
    await match.run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(app.snippets.noLogin);
  });

  it('ranks other members by taste and names the closest match', async () => {
    const app = makeFakeApp([match]);
    app.db
      .insert(schema.users)
      .values([
        { discordUserId: 'user-1', lastfmUsername: 'me' },
        { discordUserId: 'u2', lastfmUsername: 'twin' },
        { discordUserId: 'u3', lastfmUsername: 'stranger' },
        { discordUserId: 'u4', lastfmUsername: 'private' },
      ])
      .run();
    mockTop('me', top(['Autechre', 100], ['Burial', 25]));
    mockTop('twin', top(['Autechre', 90], ['Burial', 30]));
    mockTop('stranger', top(['Slayer', 100]));
    mockTop('private', 'private');

    const fake = makeFakeMessage({ content: '&taste' });
    withGuildMembers(fake, ['user-1', 'u2', 'u3', 'u4']);
    await match.run({ app, message: fake.message, args: [] });

    const embed = (fake.edits.at(-1) as { embeds: EmbedBuilder[] }).embeds[0]!;
    expect(embed.data.description).toMatch(/^1\. u2 → \*\*\d+(\.\d)?%\*\*\n2\. u3 → \*\*0%\*\*$/);
    expect(embed.data.fields?.[0]).toEqual({
      name: 'closest match: u2',
      value: 'Autechre, Burial',
    });
    expect(embed.data.footer?.text).toContain('1 skipped');
  });
});
