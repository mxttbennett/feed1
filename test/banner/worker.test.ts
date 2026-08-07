import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Client, Guild } from 'discord.js';
import { BannerScheduler } from '../../src/banner/worker.js';
import { BannerService, MAX_CONSECUTIVE_FAILURES } from '../../src/banner/service.js';
import { BannerImageStore } from '../../src/banner/store.js';
import { inspectImage } from '../../src/banner/image.js';
import { createDb, runMigrations, schema } from '../../src/db/index.js';

const NOW = 10_000_000;

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

function seed(db: ReturnType<typeof createDb>, over: Record<string, unknown> = {}) {
  db.insert(schema.bannerConfigs)
    .values({
      guildId: 'g1',
      intervalMinutes: 60,
      nextRunAt: new Date(NOW - 1000),
      setBy: 'u1',
      ...over,
    })
    .run();
}

function harness(opts: { images?: Uint8Array[]; guilds?: string[] } = {}) {
  const db = createDb(':memory:');
  runMigrations(db);
  const store = new BannerImageStore(db, mkdtempSync(join(tmpdir(), 'feed1-worker-')));
  for (const bytes of opts.images ?? [png(1)]) {
    store.add('g1', inspectImage(bytes), { addedBy: 'u1' });
  }
  const bannerSets: string[] = [];
  const errors: string[] = [];
  const service = new BannerService(db, store, { now: () => NOW, random: () => 0 });

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
    store,
    bannerSets,
    errors,
    async run() {
      scheduler.start();
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

    expect(h.bannerSets).toHaveLength(1);
    const row = h.db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.nextRunAt.getTime()).toBe(NOW + 60 * 60_000);
    expect(row.lastImageId).toBe(h.store.list('g1')[0]!.id);
  });

  it('leaves a guild that is not due yet alone', async () => {
    const h = harness();
    seed(h.db, { nextRunAt: new Date(NOW + 60_000) });

    await h.run();

    expect(h.bannerSets).toEqual([]);
  });

  // a three-day outage must cost one rotation, not 72 of them fired back to back
  it('does not accumulate missed rotations', async () => {
    const h = harness();
    seed(h.db, { nextRunAt: new Date(NOW - 3 * 24 * 60 * 60_000) });

    await h.run();

    expect(h.bannerSets).toHaveLength(1);
    expect(h.db.select().from(schema.bannerConfigs).all()[0]!.nextRunAt.getTime()).toBe(
      NOW + 60 * 60_000,
    );
  });

  it('drops the config for a guild the bot is no longer in', async () => {
    const h = harness({ guilds: [] });
    seed(h.db);

    await h.run();

    expect(h.db.select().from(schema.bannerConfigs).all()).toEqual([]);
    expect(h.bannerSets).toEqual([]);
  });

  it('records a failure without dropping the config', async () => {
    const h = harness({ images: [] });
    seed(h.db);

    await h.run();

    const row = h.db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.failureCount).toBe(1);
    expect(row.lastError).toMatch(/no-images/);
    expect(h.errors).toEqual([]);
  });

  it('disables and reports a guild that has failed too many times', async () => {
    const h = harness({ images: [] });
    seed(h.db, { failureCount: MAX_CONSECUTIVE_FAILURES - 1 });

    await h.run();

    expect(h.db.select().from(schema.bannerConfigs).all()).toEqual([]);
    expect(h.errors[0]).toMatch(/banner rotation disabled for guild g1/);
  });

  // stopping rotation must never touch the pool — `-banner start` picks up where it left off
  it('leaves the image pool alone when it disables a guild', async () => {
    const h = harness({ images: [png(1)] });
    seed(h.db, { failureCount: MAX_CONSECUTIVE_FAILURES - 1 });
    h.store.removeAll('g1');
    h.store.add('g1', inspectImage(png(9)), { addedBy: 'u1' });

    await h.run();

    expect(h.store.count('g1')).toBe(1);
  });
});
