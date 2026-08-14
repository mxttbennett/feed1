import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { LoadedImage } from './image.js';

/** Per-guild ceiling, so one server can't fill the VM's disk. */
export const MAX_IMAGES_PER_GUILD = 100;

export type BannerImage = typeof schema.bannerImages.$inferSelect;

export class GuildImageLimitReached extends Error {
  constructor() {
    super(`this server already has ${MAX_IMAGES_PER_GUILD} banner images`);
    this.name = 'GuildImageLimitReached';
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
};

export interface AddResult {
  image: BannerImage;
  /** false when an identical file was already stored for this guild */
  added: boolean;
}

/**
 * Banner images live as files under `.data/banners/`, with one row per file.
 *
 * On disk rather than in the DB because the 12-hourly `VACUUM INTO` backup copies the
 * whole database — megabytes of image data would be duplicated across every retained
 * snapshot. The deploy's `rsync --delete` excludes `.data`, so the files survive merges.
 * The trade is that images are outside the backup rotation; they are re-addable by hand.
 */
export class BannerImageStore {
  constructor(
    private readonly db: Db,
    private readonly rootDir: string,
  ) {}

  private pathFor(guildId: string, sha256: string, contentType: string): string {
    return join(this.rootDir, guildId, `${sha256}.${EXTENSIONS[contentType] ?? 'bin'}`);
  }

  list(guildId: string): BannerImage[] {
    return this.db
      .select()
      .from(schema.bannerImages)
      .where(eq(schema.bannerImages.guildId, guildId))
      .orderBy(asc(schema.bannerImages.id))
      .all();
  }

  count(guildId: string): number {
    return this.list(guildId).length;
  }

  get(guildId: string, id: number): BannerImage | undefined {
    return this.db
      .select()
      .from(schema.bannerImages)
      .where(and(eq(schema.bannerImages.guildId, guildId), eq(schema.bannerImages.id, id)))
      .get();
  }

  /** Content-hashed, so adding the same file twice is a no-op rather than a duplicate. */
  add(
    guildId: string,
    image: LoadedImage,
    meta: { addedBy: string; sourceUrl?: string | null },
  ): AddResult {
    const sha256 = createHash('sha256').update(image.data).digest('hex');
    const existing = this.db
      .select()
      .from(schema.bannerImages)
      .where(and(eq(schema.bannerImages.guildId, guildId), eq(schema.bannerImages.sha256, sha256)))
      .get();
    if (existing) return { image: existing, added: false };

    if (this.count(guildId) >= MAX_IMAGES_PER_GUILD) throw new GuildImageLimitReached();

    const file = this.pathFor(guildId, sha256, image.contentType);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, image.data);

    // the row is written last: an orphaned file is inert, an orphaned row breaks rotation
    const row = this.db
      .insert(schema.bannerImages)
      .values({
        guildId,
        sha256,
        contentType: image.contentType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        animated: image.animated,
        sourceUrl: meta.sourceUrl ?? null,
        addedBy: meta.addedBy,
      })
      .returning()
      .get();
    return { image: row, added: true };
  }

  remove(guildId: string, id: number): BannerImage | undefined {
    const row = this.get(guildId, id);
    if (!row) return undefined;
    this.db.delete(schema.bannerImages).where(eq(schema.bannerImages.id, row.id)).run();
    rmSync(this.pathFor(guildId, row.sha256, row.contentType), { force: true });
    return row;
  }

  removeAll(guildId: string): number {
    const rows = this.list(guildId);
    for (const row of rows) this.remove(guildId, row.id);
    return rows.length;
  }

  /** Undefined when the row survived but its file did not — the caller skips and moves on. */
  read(row: BannerImage): Uint8Array | undefined {
    try {
      return readFileSync(this.pathFor(row.guildId, row.sha256, row.contentType));
    } catch {
      return undefined;
    }
  }
}
