import { describe, expect, it, vi } from 'vitest';
import { Collection } from 'discord.js';
import type { Client } from 'discord.js';
import { CrownJobWorker, enqueueCrownJob, pendingJobCounts } from '../../src/crowns/worker.js';
import type { CrownService } from '../../src/crowns/service.js';
import { LastfmError } from '../../src/lastfm/errors.js';
import { createDb, runMigrations, schema } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';

function makeDb() {
  const db = createDb(':memory:');
  runMigrations(db);
  db.insert(schema.users).values({ discordUserId: 'u1', lastfmUsername: 'lfm-u1' }).run();
  return db;
}

function fakeClient(): Client {
  return {
    guilds: {
      fetch: () =>
        Promise.resolve({
          id: 'g1',
          name: 'Test Guild',
          members: {
            fetch: () =>
              Promise.resolve(
                new Collection([['u1', { user: { id: 'u1', bot: false, tag: 'u1#0' } }]]),
              ),
          },
        }),
    },
  } as unknown as Client;
}

/** Runs the worker loop until the queue is empty, then stops it. */
function drainingSleep(worker: () => CrownJobWorker, db: ReturnType<typeof makeDb>) {
  return async (_ms: number) => {
    if (db.select().from(schema.crownJobs).all().length === 0) worker().stop();
  };
}

describe('enqueueCrownJob', () => {
  it('dedupes identical jobs', () => {
    const db = makeDb();
    const job = { kind: 'artist' as const, guildId: 'g1', artistName: 'X', requestedBy: 'u1' };
    enqueueCrownJob(db, job);
    enqueueCrownJob(db, job);
    expect(db.select().from(schema.crownJobs).all()).toHaveLength(1);
    expect(pendingJobCounts(db)).toEqual({ artist: 1, album: 0 });
  });
});

describe('CrownJobWorker', () => {
  it('processes and deletes jobs', async () => {
    const db = makeDb();
    enqueueCrownJob(db, { kind: 'artist', guildId: 'g1', artistName: 'X', requestedBy: 'u1' });

    const scans: string[] = [];
    const service = {
      scan: (target: { artistName: string }) => {
        scans.push(target.artistName);
        return Promise.resolve({});
      },
    } as unknown as CrownService;

    const w: CrownJobWorker = new CrownJobWorker(db, fakeClient(), service, { sleep: drainingSleep(() => w, db) });
    w.start();
    await vi.waitFor(() => expect(db.select().from(schema.crownJobs).all()).toHaveLength(0));
    expect(scans).toEqual(['X']);
  });

  it('start() twice does not double-process', async () => {
    const db = makeDb();
    enqueueCrownJob(db, { kind: 'artist', guildId: 'g1', artistName: 'X', requestedBy: 'u1' });

    let scanCount = 0;
    const service = {
      scan: () => {
        scanCount++;
        return new Promise((r) => setTimeout(r, 20));
      },
    } as unknown as CrownService;

    const w: CrownJobWorker = new CrownJobWorker(db, fakeClient(), service, { sleep: drainingSleep(() => w, db) });
    w.start();
    w.start();
    await vi.waitFor(() => expect(db.select().from(schema.crownJobs).all()).toHaveLength(0));
    expect(scanCount).toBe(1);
  });

  it('requeues retryable failures up to the attempt cap, then reports and drops', async () => {
    const db = makeDb();
    enqueueCrownJob(db, { kind: 'artist', guildId: 'g1', artistName: 'X', requestedBy: 'u1' });

    let attempts = 0;
    const reported: string[] = [];
    const service = {
      scan: () => {
        attempts++;
        return Promise.reject(new LastfmError(29, 'Rate limit', 'artist.getinfo'));
      },
    } as unknown as CrownService;

    const w: CrownJobWorker = new CrownJobWorker(db, fakeClient(), service, {
      sleep: drainingSleep(() => w, db),
      reportError: async (_e, ctx) => {
        reported.push(ctx);
      },
    });
    w.start();
    await vi.waitFor(() => expect(db.select().from(schema.crownJobs).all()).toHaveLength(0));
    expect(attempts).toBe(3);
    expect(reported).toHaveLength(1);
  });

  it('drops non-retryable failures immediately with a report', async () => {
    const db = makeDb();
    enqueueCrownJob(db, { kind: 'artist', guildId: 'g1', artistName: 'X', requestedBy: 'u1' });

    let attempts = 0;
    const reported: string[] = [];
    const service = {
      scan: () => {
        attempts++;
        return Promise.reject(new LastfmError(6, 'not found', 'artist.getinfo'));
      },
    } as unknown as CrownService;

    const w: CrownJobWorker = new CrownJobWorker(db, fakeClient(), service, {
      sleep: drainingSleep(() => w, db),
      reportError: async (_e, ctx) => {
        reported.push(ctx);
      },
    });
    w.start();
    await vi.waitFor(() => expect(db.select().from(schema.crownJobs).all()).toHaveLength(0));
    expect(attempts).toBe(1);
    expect(reported).toHaveLength(1);
  });

  it('recovers jobs stuck in processing from a crash', () => {
    const db = makeDb();
    enqueueCrownJob(db, { kind: 'artist', guildId: 'g1', artistName: 'X', requestedBy: 'u1' });
    db.update(schema.crownJobs).set({ status: 'processing' }).run();

    const w = new CrownJobWorker(db, fakeClient(), {} as CrownService);
    expect(w.recoverStuckJobs()).toBe(1);
    const job = db.select().from(schema.crownJobs).where(eq(schema.crownJobs.status, 'pending')).get();
    expect(job).toBeDefined();
  });
});
