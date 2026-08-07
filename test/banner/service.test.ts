import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Guild } from 'discord.js';
import {
  BannerService,
  MAX_CONSECUTIVE_FAILURES,
  clampInterval,
} from '../../src/banner/service.js';
import type { BannerServiceOptions, RotateResult } from '../../src/banner/service.js';
import { BannerImageStore } from '../../src/banner/store.js';
import { inspectImage } from '../../src/banner/image.js';
import { createDb, runMigrations, schema } from '../../src/db/index.js';

function png(marker: number): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    73,
    72,
    68,
    82,
    0,
    0,
    0x07,
    0x80,
    0,
    0,
    0x04,
    0x38,
    marker,
  ]);
}
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x07, 0x38, 0x04]);

function makeService(opts: BannerServiceOptions = {}) {
  const db = createDb(':memory:');
  runMigrations(db);
  const dir = mkdtempSync(join(tmpdir(), 'feed1-svc-'));
  const store = new BannerImageStore(db, dir);
  return { db, dir, store, service: new BannerService(db, store, { random: () => 0, ...opts }) };
}

function addImages(store: BannerImageStore, bytes: Uint8Array[]) {
  return bytes.map((b) => store.add('g1', inspectImage(b), { addedBy: 'u1' }).image);
}

function fakeGuild(features: string[] = ['BANNER'], failWith?: string) {
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

function seedConfig(db: ReturnType<typeof createDb>, over: Record<string, unknown> = {}) {
  db.insert(schema.bannerConfigs)
    .values({
      guildId: 'g1',
      intervalMinutes: 60,
      nextRunAt: new Date(0),
      setBy: 'u1',
      ...over,
    })
    .run();
  return db.select().from(schema.bannerConfigs).all().at(-1)!;
}

describe('clampInterval', () => {
  it('holds the 15–2880 minute range', () => {
    expect(clampInterval(1)).toBe(15);
    expect(clampInterval(60)).toBe(60);
    expect(clampInterval(99999)).toBe(2880);
  });
});

describe('BannerService.rotate', () => {
  it('applies a data uri built from the stored bytes', async () => {
    const { service, store } = makeService();
    addImages(store, [png(1)]);
    const { guild, bannerSets } = fakeGuild();

    const result = await service.rotate(guild, null);

    expect(result).toMatchObject({ ok: true, poolSize: 1 });
    expect(bannerSets[0]).toMatch(/^data:image\/png;base64,/);
  });

  it('refuses a guild without the Banner feature', async () => {
    const { service, store } = makeService();
    addImages(store, [png(1)]);
    const { guild, bannerSets } = fakeGuild([]);

    expect(await service.rotate(guild, null)).toMatchObject({
      ok: false,
      reason: 'no-banner-feature',
    });
    expect(bannerSets).toEqual([]);
  });

  it('reports an empty pool', async () => {
    const { service } = makeService();
    expect(await service.rotate(fakeGuild().guild, null)).toMatchObject({
      ok: false,
      reason: 'no-images',
    });
  });

  it('excludes gifs unless the guild has ANIMATED_BANNER', async () => {
    const plain = makeService();
    addImages(plain.store, [GIF, png(1)]);
    const a = await plain.service.rotate(fakeGuild().guild, null);
    expect((a as Extract<RotateResult, { ok: true }>).image.animated).toBe(false);

    const animated = makeService();
    addImages(animated.store, [GIF]);
    const b = await animated.service.rotate(fakeGuild(['BANNER', 'ANIMATED_BANNER']).guild, null);
    expect((b as Extract<RotateResult, { ok: true }>).image.animated).toBe(true);
  });

  it('fails cleanly when every image is an unusable gif', async () => {
    const { service, store } = makeService();
    addImages(store, [GIF]);
    expect(await service.rotate(fakeGuild().guild, null)).toMatchObject({
      ok: false,
      reason: 'no-usable-images',
      poolSize: 1,
    });
  });

  it('does not repeat the previous banner when alternatives exist', async () => {
    for (const roll of [0, 0.99]) {
      const { service, store } = makeService({ random: () => roll });
      const [first] = addImages(store, [png(1), png(2)]);

      const result = await service.rotate(fakeGuild().guild, first!.id);

      expect((result as Extract<RotateResult, { ok: true }>).image.id).not.toBe(first!.id);
    }
  });

  it('repeats the only image rather than failing', async () => {
    const { service, store } = makeService();
    const [only] = addImages(store, [png(1)]);
    expect(await service.rotate(fakeGuild().guild, only!.id)).toMatchObject({ ok: true });
  });

  it('skips an image missing from disk and applies the next', async () => {
    const { service, store, dir } = makeService();
    const images = addImages(store, [png(1), png(2)]);
    // wipe one file behind the store's back, leaving its row intact
    rmSync(join(dir, 'g1', `${images[0]!.sha256}.png`), { force: true });
    const { guild, bannerSets } = fakeGuild();

    const result = await service.rotate(guild, null);

    expect((result as Extract<RotateResult, { ok: true }>).image.id).toBe(images[1]!.id);
    expect(bannerSets).toHaveLength(1);
  });

  it('gives up when no file can be read', async () => {
    const { service, store, dir } = makeService();
    addImages(store, [png(1), png(2)]);
    rmSync(join(dir, 'g1'), { recursive: true, force: true });

    expect(await service.rotate(fakeGuild().guild, null)).toMatchObject({
      ok: false,
      reason: 'image-unreadable',
    });
  });

  it('surfaces a Discord rejection', async () => {
    const { service, store } = makeService();
    addImages(store, [png(1)]);

    const result = await service.rotate(fakeGuild(['BANNER'], 'Missing Permissions').guild, null);

    expect(result).toMatchObject({ ok: false, reason: 'set-banner-failed' });
    expect((result as Extract<RotateResult, { ok: false }>).detail).toMatch(/Missing Permissions/);
  });
});

describe('BannerService.recordResult', () => {
  it('advances nextRunAt and clears failures on success', () => {
    const now = 1_000_000;
    const { service, db, store } = makeService({ now: () => now });
    const [image] = addImages(store, [png(1)]);
    const config = seedConfig(db, { failureCount: 3, lastError: 'boom' });

    service.recordResult(config, { ok: true, image: image!, poolSize: 1 });

    const row = db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row).toMatchObject({ failureCount: 0, lastError: null, lastImageId: image!.id });
    expect(row.nextRunAt.getTime()).toBe(now + 60 * 60_000);
  });

  // a failing guild that never reschedules would be retried on every 60s tick forever
  it('advances nextRunAt on failure too', () => {
    const now = 1_000_000;
    const { service, db } = makeService({ now: () => now });
    const config = seedConfig(db);

    service.recordResult(config, { ok: false, reason: 'no-images', detail: 'nothing here' });

    const row = db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.failureCount).toBe(1);
    expect(row.lastError).toMatch(/no-images/);
    expect(row.nextRunAt.getTime()).toBe(now + 60 * 60_000);
  });
});

describe('BannerService bookkeeping', () => {
  it('flags exhaustion on the failure that reaches the cap', () => {
    const { service, db } = makeService();
    expect(
      service.isExhausted(seedConfig(db, { failureCount: MAX_CONSECUTIVE_FAILURES - 2 })),
    ).toBe(false);
    db.delete(schema.bannerConfigs).run();
    expect(
      service.isExhausted(seedConfig(db, { failureCount: MAX_CONSECUTIVE_FAILURES - 1 })),
    ).toBe(true);
  });

  it('returns only due configs, soonest first', () => {
    const now = 5_000_000;
    const { service, db } = makeService({ now: () => now });
    seedConfig(db, { guildId: 'due-late', nextRunAt: new Date(now - 1000) });
    seedConfig(db, { guildId: 'due-early', nextRunAt: new Date(now - 9000) });
    seedConfig(db, { guildId: 'not-yet', nextRunAt: new Date(now + 1000) });

    expect(service.dueConfigs().map((c) => c.guildId)).toEqual(['due-early', 'due-late']);
  });

  it('stops and starts without losing the image pool', () => {
    const { service, store } = makeService();
    addImages(store, [png(1), png(2)]);
    service.upsertConfig({ guildId: 'g1', intervalMinutes: 60, setBy: 'u1' });

    expect(service.deleteConfig('g1')).toBe(true);

    expect(service.getConfig('g1')).toBeUndefined();
    expect(store.count('g1')).toBe(2);
  });
});
