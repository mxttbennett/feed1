import { describe, expect, it } from 'vitest';
import type { Client, Guild } from 'discord.js';
import { BannerScheduler } from '../../src/banner/worker.js';
import { BannerService, MAX_CONSECUTIVE_FAILURES } from '../../src/banner/service.js';
import type { ImgurImage } from '../../src/banner/imgur.js';
import { createDb, runMigrations, schema } from '../../src/db/index.js';

const NOW = 10_000_000;

function makeDb() {
  const db = createDb(':memory:');
  runMigrations(db);
  return db;
}

function img(id: string): ImgurImage {
  return {
    id,
    link: `https://i.imgur.com/${id}.png`,
    type: 'image/png',
    animated: false,
    width: 1920,
    height: 1080,
    size: 10,
  };
}

function fakeClient(knownGuildIds: string[], bannerSets: string[]): Client {
  return {
    guilds: {
      fetch: (id: string) =>
        knownGuildIds.includes(id)
          ? Promise.resolve({
              id,
              name: `guild-${id}`,
              features: ['BANNER'],
              setBanner: (data: string) => {
                bannerSets.push(data);
                return Promise.resolve();
              },
            } as unknown as Guild)
          : Promise.reject(new Error('Unknown Guild')),
    },
  } as unknown as Client;
}

function seed(db: ReturnType<typeof makeDb>, over: Record<string, unknown> = {}) {
  db.insert(schema.bannerConfigs)
    .values({
      guildId: 'g1',
      albumUrl: 'https://imgur.com/a/abc',
      albumHash: 'abc',
      intervalMinutes: 60,
      nextRunAt: new Date(NOW - 1000),
      setBy: 'u1',
      ...over,
    })
    .run();
}

interface Harness {
  db: ReturnType<typeof makeDb>;
  bannerSets: string[];
  errors: string[];
  run(): Promise<void>;
}

function harness(
  opts: { album?: ImgurImage[]; guilds?: string[]; albumError?: Error } = {},
): Harness {
  const db = makeDb();
  const bannerSets: string[] = [];
  const errors: string[] = [];
  const service = new BannerService(db, 'test-id', {
    imgur: {
      fetchAlbumImages: () =>
        opts.albumError
          ? Promise.reject(opts.albumError)
          : Promise.resolve(opts.album ?? [img('a')]),
    } as never,
    fetchImage: (url: string) =>
      Promise.resolve({
        dataUri: `data:image/png;base64,${url}`,
        contentType: 'image/png',
        bytes: 10,
      }),
    now: () => NOW,
  });

  // one pass: the loop stops itself the first time it reaches an idle sleep
  const scheduler = new BannerScheduler(fakeClient(opts.guilds ?? ['g1'], bannerSets), service, {
    sleep: async (ms: number) => {
      if (ms >= 60_000) scheduler.stop();
    },
    reportError: (error, context) => {
      errors.push(`${context}: ${String(error)}`);
      return Promise.resolve();
    },
  });

  return {
    db,
    bannerSets,
    errors,
    async run() {
      scheduler.start();
      // let the loop drain; each await yields back to this microtask queue
      for (let i = 0; i < 50; i++) await Promise.resolve();
      scheduler.stop();
    },
  };
}

describe('BannerScheduler', () => {
  it('rotates a due guild and reschedules it', async () => {
    const h = harness();
    seed(h.db);

    await h.run();

    expect(h.bannerSets).toEqual(['data:image/png;base64,https://i.imgur.com/a.png']);
    const row = h.db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.nextRunAt.getTime()).toBe(NOW + 60 * 60_000);
    expect(row.lastImageUrl).toBe('https://i.imgur.com/a.png');
  });

  it('leaves a guild that is not due yet alone', async () => {
    const h = harness();
    seed(h.db, { nextRunAt: new Date(NOW + 60_000) });

    await h.run();

    expect(h.bannerSets).toEqual([]);
  });

  // A three-day outage must cost one rotation, not 72 of them fired back to back.
  it('does not accumulate missed rotations', async () => {
    const h = harness();
    seed(h.db, { nextRunAt: new Date(NOW - 3 * 24 * 60 * 60_000) });

    await h.run();

    expect(h.bannerSets).toHaveLength(1);
    const row = h.db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.nextRunAt.getTime()).toBe(NOW + 60 * 60_000);
  });

  it('drops the config for a guild the bot is no longer in', async () => {
    const h = harness({ guilds: [] });
    seed(h.db);

    await h.run();

    expect(h.db.select().from(schema.bannerConfigs).all()).toEqual([]);
    expect(h.bannerSets).toEqual([]);
  });

  it('records a failure without dropping the config', async () => {
    const h = harness({ albumError: new Error('imgur is down') });
    seed(h.db);

    await h.run();

    const row = h.db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.failureCount).toBe(1);
    expect(row.lastError).toMatch(/album-unavailable/);
    expect(h.errors).toEqual([]);
  });

  it('disables and reports a guild that has failed too many times', async () => {
    const h = harness({ albumError: new Error('imgur is down') });
    seed(h.db, { failureCount: MAX_CONSECUTIVE_FAILURES - 1 });

    await h.run();

    expect(h.db.select().from(schema.bannerConfigs).all()).toEqual([]);
    expect(h.errors[0]).toMatch(/banner rotation disabled for guild g1/);
  });

  it('stays off when there is no imgur client id', async () => {
    const db = makeDb();
    const service = new BannerService(db, undefined);
    const scheduler = new BannerScheduler({} as Client, service);
    seed(db);

    scheduler.start();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const row = db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.nextRunAt.getTime()).toBe(NOW - 1000);
  });
});
