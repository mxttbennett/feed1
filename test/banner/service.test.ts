import { describe, expect, it } from 'vitest';
import type { Guild } from 'discord.js';
import {
  BannerService,
  MAX_CONSECUTIVE_FAILURES,
  clampInterval,
} from '../../src/banner/service.js';
import type { BannerServiceOptions, RotateResult } from '../../src/banner/service.js';
import type { ImgurImage } from '../../src/banner/imgur.js';
import { createDb, runMigrations, schema } from '../../src/db/index.js';

function makeDb() {
  const db = createDb(':memory:');
  runMigrations(db);
  return db;
}

function img(id: string, over: Partial<ImgurImage> = {}): ImgurImage {
  return {
    id,
    link: `https://i.imgur.com/${id}.png`,
    type: 'image/png',
    animated: false,
    width: 1920,
    height: 1080,
    size: 100,
    ...over,
  };
}

interface FakeGuild {
  guild: Guild;
  bannerSets: string[];
}

function fakeGuild(features: string[] = ['BANNER'], failWith?: string): FakeGuild {
  const bannerSets: string[] = [];
  const guild = {
    id: 'g1',
    name: 'Test Guild',
    features,
    setBanner: (data: string) => {
      if (failWith) return Promise.reject(new Error(failWith));
      bannerSets.push(data);
      return Promise.resolve();
    },
  } as unknown as Guild;
  return { guild, bannerSets };
}

function makeService(
  db: ReturnType<typeof makeDb>,
  album: ImgurImage[],
  opts: Partial<BannerServiceOptions> & {
    albumError?: Error;
    imageError?: (url: string) => boolean;
  } = {},
) {
  const fetched: string[] = [];
  const service = new BannerService(db, 'test-id', {
    imgur: {
      fetchAlbumImages: () =>
        opts.albumError ? Promise.reject(opts.albumError) : Promise.resolve(album),
    } as never,
    fetchImage: (url: string) => {
      fetched.push(url);
      if (opts.imageError?.(url)) return Promise.reject(new Error(`bad image ${url}`));
      return Promise.resolve({
        dataUri: `data:image/png;base64,${url}`,
        contentType: 'image/png',
        bytes: 10,
      });
    },
    random: opts.random ?? (() => 0),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { service, fetched };
}

function seedConfig(db: ReturnType<typeof makeDb>, over: Record<string, unknown> = {}) {
  db.insert(schema.bannerConfigs)
    .values({
      guildId: 'g1',
      albumUrl: 'https://imgur.com/a/abc',
      albumHash: 'abc',
      intervalMinutes: 60,
      nextRunAt: new Date(0),
      setBy: 'u1',
      ...over,
    })
    .run();
  return db.select().from(schema.bannerConfigs).all()[0]!;
}

describe('clampInterval', () => {
  it('holds the 15–2880 minute range', () => {
    expect(clampInterval(1)).toBe(15);
    expect(clampInterval(60)).toBe(60);
    expect(clampInterval(99999)).toBe(2880);
  });
});

describe('BannerService.rotate', () => {
  it('applies a data uri built from the picked image', async () => {
    const { service } = makeService(makeDb(), [img('a')]);
    const { guild, bannerSets } = fakeGuild();

    const result = await service.rotate(guild, { albumHash: 'abc', lastImageUrl: null });
    expect(result).toMatchObject({ ok: true, albumSize: 1 });
    expect(bannerSets).toEqual(['data:image/png;base64,https://i.imgur.com/a.png']);
  });

  it('refuses a guild without the Banner feature', async () => {
    const { service } = makeService(makeDb(), [img('a')]);
    const { guild, bannerSets } = fakeGuild([]);

    const result = await service.rotate(guild, { albumHash: 'abc', lastImageUrl: null });
    expect(result).toMatchObject({ ok: false, reason: 'no-banner-feature' });
    expect(bannerSets).toEqual([]);
  });

  it('excludes gifs unless the guild has ANIMATED_BANNER', async () => {
    const album = [img('gif', { animated: true, type: 'image/gif' }), img('png')];

    const plain = makeService(makeDb(), album);
    const a = await plain.service.rotate(fakeGuild().guild, {
      albumHash: 'abc',
      lastImageUrl: null,
    });
    expect(a).toMatchObject({ ok: true });
    expect((a as Extract<RotateResult, { ok: true }>).image.id).toBe('png');

    // gif-only album: a guild with ANIMATED_BANNER must be able to use it, and one without cannot
    const gifOnly = [img('gif', { animated: true, type: 'image/gif' })];
    const animated = makeService(makeDb(), gifOnly);
    const b = await animated.service.rotate(fakeGuild(['BANNER', 'ANIMATED_BANNER']).guild, {
      albumHash: 'abc',
      lastImageUrl: null,
    });
    expect((b as Extract<RotateResult, { ok: true }>).image.id).toBe('gif');
  });

  it('fails cleanly when every image is an unusable gif', async () => {
    const { service } = makeService(makeDb(), [img('gif', { animated: true, type: 'image/gif' })]);
    const result = await service.rotate(fakeGuild().guild, {
      albumHash: 'abc',
      lastImageUrl: null,
    });
    expect(result).toMatchObject({ ok: false, reason: 'no-usable-images', albumSize: 1 });
  });

  it('reports an empty album', async () => {
    const { service } = makeService(makeDb(), []);
    const result = await service.rotate(fakeGuild().guild, {
      albumHash: 'abc',
      lastImageUrl: null,
    });
    expect(result).toMatchObject({ ok: false, reason: 'album-empty' });
  });

  it('reports an unreachable album', async () => {
    const { service } = makeService(makeDb(), [], { albumError: new Error('404') });
    const result = await service.rotate(fakeGuild().guild, {
      albumHash: 'abc',
      lastImageUrl: null,
    });
    expect(result).toMatchObject({ ok: false, reason: 'album-unavailable' });
  });

  it('does not repeat the previous banner when alternatives exist', async () => {
    const album = [img('a'), img('b')];
    for (const roll of [0, 0.99]) {
      const { service } = makeService(makeDb(), album, { random: () => roll });
      const result = await service.rotate(fakeGuild().guild, {
        albumHash: 'abc',
        lastImageUrl: 'https://i.imgur.com/a.png',
      });
      expect((result as Extract<RotateResult, { ok: true }>).image.id).toBe('b');
    }
  });

  it('repeats the only image rather than failing', async () => {
    const { service } = makeService(makeDb(), [img('a')]);
    const result = await service.rotate(fakeGuild().guild, {
      albumHash: 'abc',
      lastImageUrl: 'https://i.imgur.com/a.png',
    });
    expect(result).toMatchObject({ ok: true });
  });

  it('skips a bad image and applies the next one', async () => {
    // fail whichever the shuffle picks first, so the assertion doesn't depend on the order
    let attempts = 0;
    const { service, fetched } = makeService(makeDb(), [img('a'), img('b')], {
      imageError: () => ++attempts === 1,
    });
    const { guild, bannerSets } = fakeGuild();

    const result = await service.rotate(guild, { albumHash: 'abc', lastImageUrl: null });
    expect(result).toMatchObject({ ok: true });
    expect(fetched).toHaveLength(2);
    expect(bannerSets).toEqual([`data:image/png;base64,${fetched[1]!}`]);
  });

  it('gives up when no image downloads', async () => {
    const { service } = makeService(makeDb(), [img('a'), img('b')], { imageError: () => true });
    const result = await service.rotate(fakeGuild().guild, {
      albumHash: 'abc',
      lastImageUrl: null,
    });
    expect(result).toMatchObject({ ok: false, reason: 'image-fetch-failed' });
  });

  it('surfaces a Discord rejection', async () => {
    const { service } = makeService(makeDb(), [img('a')]);
    const result = await service.rotate(fakeGuild(['BANNER'], 'Missing Permissions').guild, {
      albumHash: 'abc',
      lastImageUrl: null,
    });
    expect(result).toMatchObject({ ok: false, reason: 'set-banner-failed' });
    expect((result as Extract<RotateResult, { ok: false }>).detail).toMatch(/Missing Permissions/);
  });
});

describe('BannerService.recordResult', () => {
  it('advances nextRunAt and clears failures on success', () => {
    const db = makeDb();
    const now = 1_000_000;
    const { service } = makeService(db, [img('a')], { now: () => now });
    const config = seedConfig(db, { failureCount: 3, lastError: 'boom' });

    service.recordResult(config, { ok: true, image: img('a'), albumSize: 1 });

    const row = db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.failureCount).toBe(0);
    expect(row.lastError).toBeNull();
    expect(row.lastImageUrl).toBe('https://i.imgur.com/a.png');
    expect(row.nextRunAt.getTime()).toBe(now + 60 * 60_000);
  });

  // A failing guild that never reschedules would be retried on every 60s tick forever.
  it('advances nextRunAt on failure too', () => {
    const db = makeDb();
    const now = 1_000_000;
    const { service } = makeService(db, [], { now: () => now });
    const config = seedConfig(db);

    service.recordResult(config, { ok: false, reason: 'album-empty', detail: 'nothing here' });

    const row = db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.failureCount).toBe(1);
    expect(row.lastError).toMatch(/album-empty/);
    expect(row.nextRunAt.getTime()).toBe(now + 60 * 60_000);
  });
});

describe('BannerService bookkeeping', () => {
  it('flags exhaustion on the failure that reaches the cap', () => {
    const db = makeDb();
    const { service } = makeService(db, []);
    expect(
      service.isExhausted(seedConfig(db, { failureCount: MAX_CONSECUTIVE_FAILURES - 2 })),
    ).toBe(false);
    db.delete(schema.bannerConfigs).run();
    expect(
      service.isExhausted(seedConfig(db, { failureCount: MAX_CONSECUTIVE_FAILURES - 1 })),
    ).toBe(true);
  });

  it('returns only due configs, soonest first', () => {
    const db = makeDb();
    const now = 5_000_000;
    const { service } = makeService(db, [], { now: () => now });
    seedConfig(db, { guildId: 'due-late', nextRunAt: new Date(now - 1000) });
    seedConfig(db, { guildId: 'due-early', nextRunAt: new Date(now - 9000) });
    seedConfig(db, { guildId: 'not-yet', nextRunAt: new Date(now + 1000) });

    expect(service.dueConfigs().map((c) => c.guildId)).toEqual(['due-early', 'due-late']);
  });

  it('reports unconfigured when there is no client id', () => {
    const service = new BannerService(makeDb(), undefined);
    expect(service.configured).toBe(false);
    expect(() => service.client).toThrow(/not configured/);
  });
});
