import { asc, eq, inArray } from 'drizzle-orm';
import type { Client } from 'discord.js';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { CrownService } from './service.js';
import { gatherRegisteredMembers } from './members.js';
import { LastfmError } from '../lastfm/errors.js';

type JobRow = typeof schema.crownJobs.$inferSelect;

const MAX_ATTEMPTS = 3;
const ITEM_DELAY_MS = 10_000;
const IDLE_DELAY_MS = 5 * 60_000;

export interface WorkerHooks {
  sleep?: (ms: number) => Promise<void>;
  reportError?: (error: unknown, context: string) => Promise<void>;
}

/** Enqueue a crown recompute, silently deduping against an identical pending job. */
export function enqueueCrownJob(
  db: Db,
  job: {
    kind: 'artist' | 'album';
    guildId: string;
    artistName: string;
    albumName?: string;
    requestedBy: string;
  },
): void {
  db.insert(schema.crownJobs)
    .values({
      kind: job.kind,
      guildId: job.guildId,
      artistName: job.artistName,
      albumName: job.albumName ?? '',
      requestedBy: job.requestedBy,
    })
    .onConflictDoNothing()
    .run();
}

export function pendingJobCounts(db: Db): { artist: number; album: number } {
  const rows = db.select().from(schema.crownJobs).all();
  return {
    artist: rows.filter((r) => r.kind === 'artist').length,
    album: rows.filter((r) => r.kind === 'album').length,
  };
}

/**
 * Singleton background drain loop over crown_jobs. Claims a job (status flag),
 * processes it, deletes it on success — a crash leaves the row for recovery.
 */
export class CrownJobWorker {
  private running = false;
  private stopped = false;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly reportError: (error: unknown, context: string) => Promise<void>;

  constructor(
    private readonly db: Db,
    private readonly client: Client,
    private readonly service: CrownService,
    hooks: WorkerHooks = {},
  ) {
    this.sleep = hooks.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.reportError = hooks.reportError ?? (async (e, c) => console.error(`[${c}]`, e));
  }

  /** Starts the loop; calling again while running is a no-op. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
  }

  /** Reset jobs left in 'processing' by a previous crash so they run again. */
  recoverStuckJobs(): number {
    const stuck = this.db
      .select()
      .from(schema.crownJobs)
      .where(eq(schema.crownJobs.status, 'processing'))
      .all();
    if (stuck.length > 0) {
      this.db
        .update(schema.crownJobs)
        .set({ status: 'pending' })
        .where(inArray(schema.crownJobs.id, stuck.map((j) => j.id)))
        .run();
    }
    return stuck.length;
  }

  private claimNext(): JobRow | null {
    const job = this.db
      .select()
      .from(schema.crownJobs)
      .where(eq(schema.crownJobs.status, 'pending'))
      .orderBy(asc(schema.crownJobs.id))
      .limit(1)
      .get();
    if (!job) return null;
    this.db
      .update(schema.crownJobs)
      .set({ status: 'processing', attempts: job.attempts + 1 })
      .where(eq(schema.crownJobs.id, job.id))
      .run();
    return { ...job, attempts: job.attempts + 1 };
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const job = this.claimNext();
      if (!job) {
        await this.sleep(IDLE_DELAY_MS);
        continue;
      }
      try {
        await this.processJob(job);
        this.db.delete(schema.crownJobs).where(eq(schema.crownJobs.id, job.id)).run();
      } catch (error) {
        const retryable = error instanceof LastfmError && error.retryable;
        if (retryable && job.attempts < MAX_ATTEMPTS) {
          this.db
            .update(schema.crownJobs)
            .set({ status: 'pending' })
            .where(eq(schema.crownJobs.id, job.id))
            .run();
        } else {
          this.db.delete(schema.crownJobs).where(eq(schema.crownJobs.id, job.id)).run();
          await this.reportError(
            error,
            `crown job ${job.kind} ${job.artistName}${job.albumName ? ` — ${job.albumName}` : ''} (guild ${job.guildId})`,
          );
        }
      }
      await this.sleep(ITEM_DELAY_MS);
    }
  }

  private async processJob(job: JobRow): Promise<void> {
    const guild = await this.client.guilds.fetch(job.guildId);
    const members = await gatherRegisteredMembers(this.db, guild);
    if (members.length === 0) return;
    await this.service.scan(
      {
        guildId: job.guildId,
        guildName: guild.name,
        artistName: job.artistName,
        ...(job.kind === 'album' ? { albumName: job.albumName } : {}),
      },
      members,
    );
  }
}
