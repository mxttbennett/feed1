import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chartCommands, CHART_PERIODS } from '../../src/commands/charts.js';
import { chartStatsText } from '../../src/charts/render.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';

const BASE = 'https://ws.audioscrobbler.com';
const byName = (name: string) => chartCommands.find((c) => c.name === name)!;

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

function seed(app: ReturnType<typeof makeFakeApp>) {
  app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'lfm1' }).run();
}

describe('chart command family', () => {
  it('registers the six period wrappers plus chart and nt', () => {
    for (const name of ['w', 'm', '3m', '6m', 'y', 'o', 'chart', 'nt']) {
      expect(byName(name)).toBeDefined();
    }
    expect(CHART_PERIODS.weekly!.period).toBe('7day');
    expect(CHART_PERIODS.yearly!.period).toBe('12month');
  });

  it('requires login', async () => {
    const app = makeFakeApp(chartCommands);
    const fake = makeFakeMessage({ content: '&w' });
    await byName('w').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(app.snippets.noLogin);
  });
});

describe('ranked-pick family', () => {
  it('a6m queries 6month (fixing the legacy 3month bug)', async () => {
    const queries: Record<string, string>[] = [];
    nock(BASE)
      .get('/2.0/')
      .query((q) => {
        queries.push(q as Record<string, string>);
        return q.method === 'user.gettopalbums';
      })
      .reply(200, {
        topalbums: {
          album: [
            { name: 'Confield', playcount: '55', artist: { name: 'Autechre', url: '' }, image: [], url: '' },
          ],
          '@attr': { total: '100' },
        },
      });

    const app = makeFakeApp(chartCommands);
    seed(app);
    const fake = makeFakeMessage({ content: '&a6m 4' });
    await byName('a6m').run({ app, message: fake.message, args: ['4'] });

    expect(queries[0]!.period).toBe('6month');
    expect(fake.replies[0]).toBe(
      'your #4 album of the past 6 months: **Autechre** — ***Confield*** with **55** plays',
    );
  });

  it('ao queries overall explicitly (fixing the legacy undefined-period bug)', async () => {
    const queries: Record<string, string>[] = [];
    nock(BASE)
      .get('/2.0/')
      .query((q) => {
        queries.push(q as Record<string, string>);
        return q.method === 'user.gettopalbums';
      })
      .reply(200, {
        topalbums: {
          album: [
            { name: 'X', playcount: '9', artist: { name: 'Y', url: '' }, image: [], url: '' },
          ],
          '@attr': { total: '1' },
        },
      });

    const app = makeFakeApp(chartCommands);
    seed(app);
    const fake = makeFakeMessage({ content: '&ao 1' });
    await byName('ao').run({ app, message: fake.message, args: ['1'] });
    expect(queries[0]!.period).toBe('overall');
    expect(fake.replies[0]).toBe('your #1 album of all-time: **Y** — ***X*** with **9** plays');
  });

  it('artist picks reply text-only with the legacy format', async () => {
    nock(BASE)
      .get('/2.0/')
      .query((q) => q.method === 'user.gettopartists')
      .reply(200, {
        topartists: {
          artist: [{ name: 'Autechre', playcount: '400', url: '' }],
          '@attr': { total: '50' },
        },
      });
    const app = makeFakeApp(chartCommands);
    seed(app);
    const fake = makeFakeMessage({ content: '&arw 2' });
    await byName('arw').run({ app, message: fake.message, args: ['2'] });
    expect(fake.replies[0]).toBe(
      'your #2 artist of the past week: ***Autechre*** with **400** plays',
    );
  });

  it('tells you when the requested rank does not exist', async () => {
    nock(BASE)
      .get('/2.0/')
      .query(true)
      .reply(200, { topalbums: { album: [], '@attr': { total: '0' } } });
    const app = makeFakeApp(chartCommands);
    seed(app);
    const fake = makeFakeMessage({ content: '&aw 9999' });
    await byName('aw').run({ app, message: fake.message, args: ['9999'] });
    expect(fake.replies[0]).toBe("you don't have a #9999 album of the past week.");
  });
});

describe('chartStatsText', () => {
  it('matches the legacy ★ block', () => {
    expect(chartStatsText(120, 400, 17.14, 57.14, 3, 2)).toBe(
      '★ 120 / 400 scrobbles ★\n' +
        '★ 17.14 / 57.14 scrobbles per day ★\n' +
        '★ 30% chart coverage ★\n' +
        '★ 3 new albums ★\n' +
        '★ 2 crowns ★',
    );
  });

  it('uses singular forms', () => {
    const text = chartStatsText(10, 10, 1, 1, 1, 1);
    expect(text).toContain('★ 1 new album ★');
    expect(text).toContain('★ 1 crown ★');
  });
});
