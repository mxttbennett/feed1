import { GuildFeature } from 'discord.js';
import type { Guild } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { KeyedMutex } from '../core/mutex.js';
import { ImgurClient } from './imgur.js';
import type { ImgurImage } from './imgur.js';
import { fetchBannerImage } from './image.js';
import type { FetchedImage } from './image.js';

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 2880;
export const DEFAULT_INTERVAL_MINUTES = 1440;

/** Consecutive failures before a guild's config is dropped — the lost-boost case. */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** How many images to try before giving up on a rotation, so one bad file isn't fatal. */
const MAX_IMAGE_ATTEMPTS = 3;

export type BannerConfig = typeof schema.bannerConfigs.$inferSelect;

export type RotateFailure =
  | 'no-banner-feature'
  | 'album-empty'
  | 'no-usable-images'
  | 'album-unavailable'
  | 'image-fetch-failed'
  | 'set-banner-failed';

export type RotateResult =
  | { ok: true; image: ImgurImage; albumSize: number }
  | { ok: false; reason: RotateFailure; detail: string; albumSize?: number };

export interface BannerServiceOptions {
  imgur?: ImgurClient;
  fetchImage?: (url: string) => Promise<FetchedImage>;
  now?: () => number;
  random?: () => number;
}

export function clampInterval(minutes: number): number {
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(minutes)));
}

export class BannerService {
  private readonly locks = new KeyedMutex();
  private readonly imgur: ImgurClient | undefined;
  private readonly fetchImage: (url: string) => Promise<FetchedImage>;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(
    private readonly db: Db,
    clientId: string | undefined,
    opts: BannerServiceOptions = {},
  ) {
    this.imgur = opts.imgur ?? (clientId ? new ImgurClient(clientId) : undefined);
    this.fetchImage = opts.fetchImage ?? ((url) => fetchBannerImage(url));
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  get configured(): boolean {
    return this.imgur !== undefined;
  }

  /** Throws when unconfigured — callers must check `configured` first. */
  get client(): ImgurClient {
    if (!this.imgur) throw new Error('banner rotation is not configured (no IMGUR_CLIENT_ID)');
    return this.imgur;
  }

  getConfig(guildId: string): BannerConfig | undefined {
    return this.db
      .select()
      .from(schema.bannerConfigs)
      .where(eq(schema.bannerConfigs.guildId, guildId))
      .get();
  }

  deleteConfig(guildId: string): boolean {
    const existing = this.getConfig(guildId);
    if (!existing) return false;
    this.db.delete(schema.bannerConfigs).where(eq(schema.bannerConfigs.guildId, guildId)).run();
    return true;
  }

  /** Next run is always measured from now, so a long outage costs one rotation, not a backlog. */
  scheduleFrom(intervalMinutes: number): Date {
    return new Date(this.now() + intervalMinutes * 60_000);
  }

  upsertConfig(row: {
    guildId: string;
    albumUrl: string;
    albumHash: string;
    intervalMinutes: number;
    setBy: string;
    lastImageUrl?: string | null;
  }): void {
    const values = {
      guildId: row.guildId,
      albumUrl: row.albumUrl,
      albumHash: row.albumHash,
      intervalMinutes: row.intervalMinutes,
      nextRunAt: this.scheduleFrom(row.intervalMinutes),
      lastImageUrl: row.lastImageUrl ?? null,
      lastAppliedAt: new Date(this.now()),
      failureCount: 0,
      lastError: null,
      setBy: row.setBy,
    };
    this.db
      .insert(schema.bannerConfigs)
      .values(values)
      .onConflictDoUpdate({ target: schema.bannerConfigs.guildId, set: values })
      .run();
  }

  setInterval(guildId: string, intervalMinutes: number): void {
    this.db
      .update(schema.bannerConfigs)
      .set({ intervalMinutes, nextRunAt: this.scheduleFrom(intervalMinutes) })
      .where(eq(schema.bannerConfigs.guildId, guildId))
      .run();
  }

  /**
   * Pick an image from the album and apply it. Serialized per guild — two admins racing
   * `-banner next` must not produce two overlapping guild edits.
   */
  rotate(
    guild: Guild,
    config: Pick<BannerConfig, 'albumHash' | 'lastImageUrl'>,
  ): Promise<RotateResult> {
    return this.locks.run(guild.id, () => this.rotateInner(guild, config));
  }

  private async rotateInner(
    guild: Guild,
    config: Pick<BannerConfig, 'albumHash' | 'lastImageUrl'>,
  ): Promise<RotateResult> {
    if (!guild.features.includes(GuildFeature.Banner)) {
      return {
        ok: false,
        reason: 'no-banner-feature',
        detail: 'this server does not have the Banner feature (it needs boost level 1 or higher)',
      };
    }

    let album: ImgurImage[];
    try {
      album = await this.client.fetchAlbumImages(config.albumHash);
    } catch (error) {
      return { ok: false, reason: 'album-unavailable', detail: String(error) };
    }
    if (album.length === 0) {
      return { ok: false, reason: 'album-empty', detail: 'that album has no png/jpeg/gif images' };
    }

    const animatedOk = guild.features.includes(GuildFeature.AnimatedBanner);
    const usable = album.filter((img) => animatedOk || !img.animated);
    if (usable.length === 0) {
      return {
        ok: false,
        reason: 'no-usable-images',
        detail: 'every image in that album is a gif, and this server cannot use animated banners',
        albumSize: album.length,
      };
    }

    const candidates = this.orderCandidates(usable, config.lastImageUrl);
    let lastDetail = '';
    for (const image of candidates.slice(0, MAX_IMAGE_ATTEMPTS)) {
      let fetched: FetchedImage;
      try {
        fetched = await this.fetchImage(image.link);
      } catch (error) {
        lastDetail = String(error);
        continue;
      }
      try {
        await guild.setBanner(fetched.dataUri, 'feed1 banner rotation');
      } catch (error) {
        return {
          ok: false,
          reason: 'set-banner-failed',
          detail: String(error),
          albumSize: album.length,
        };
      }
      return { ok: true, image, albumSize: album.length };
    }

    return {
      ok: false,
      reason: 'image-fetch-failed',
      detail: lastDetail || 'could not download any image from that album',
      albumSize: album.length,
    };
  }

  /** Random order, with the previous banner demoted to last so it can't repeat back to back. */
  private orderCandidates(images: ImgurImage[], lastImageUrl: string | null): ImgurImage[] {
    const shuffled = [...images];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    if (shuffled.length < 2 || !lastImageUrl) return shuffled;
    const repeats = shuffled.filter((img) => img.link === lastImageUrl);
    if (repeats.length === 0) return shuffled;
    return [...shuffled.filter((img) => img.link !== lastImageUrl), ...repeats];
  }

  /** Record the outcome. `nextRunAt` advances either way so a broken guild can't hot-loop. */
  recordResult(config: BannerConfig, result: RotateResult): void {
    const nextRunAt = this.scheduleFrom(config.intervalMinutes);
    if (result.ok) {
      this.db
        .update(schema.bannerConfigs)
        .set({
          nextRunAt,
          lastImageUrl: result.image.link,
          lastAppliedAt: new Date(this.now()),
          failureCount: 0,
          lastError: null,
        })
        .where(eq(schema.bannerConfigs.guildId, config.guildId))
        .run();
      return;
    }
    this.db
      .update(schema.bannerConfigs)
      .set({
        nextRunAt,
        failureCount: config.failureCount + 1,
        lastError: `${result.reason}: ${result.detail}`.slice(0, 500),
      })
      .where(eq(schema.bannerConfigs.guildId, config.guildId))
      .run();
  }

  /** True when the guild has now failed enough times to be dropped. */
  isExhausted(config: BannerConfig): boolean {
    return config.failureCount + 1 >= MAX_CONSECUTIVE_FAILURES;
  }

  dueConfigs(): BannerConfig[] {
    const now = this.now();
    return this.db
      .select()
      .from(schema.bannerConfigs)
      .all()
      .filter((row) => row.nextRunAt.getTime() <= now)
      .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime());
  }
}
