import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { LastfmClient } from '../lastfm/client.js';
import { LastfmError } from '../lastfm/errors.js';
import { highestResImageUrl, toInt } from '../lastfm/types.js';
import type { KeyedMutex } from '../core/mutex.js';

export type CrownKind = 'artist' | 'album';

export interface RegisteredMember {
  userId: string;
  tag: string;
  lastfmUsername: string;
}

export interface Listener {
  userId: string;
  tag: string;
  lastfmUsername: string;
  plays: number;
}

export interface CrownChange {
  kind: CrownKind;
  guildId: string;
  guildName: string;
  artistName: string;
  albumName: string | null;
  prevOwnerId: string | null;
  newOwnerId: string;
  prevPlays: number | null;
  newPlays: number;
}

export interface ScanResult {
  /** every registered member, including zero-play, sorted by plays desc */
  listeners: Listener[];
  totalPlays: number;
  listenerCount: number;
  change: CrownChange | null;
  tookMs: number;
  /** canonical names as returned by Last.fm (autocorrected casing) */
  artistName: string;
  albumName: string | null;
  artistUrl: string | null;
  albumUrl: string | null;
  imageUrl: string | null;
}

export interface ScanTarget {
  guildId: string;
  guildName: string;
  artistName: string;
  albumName?: string;
}

export class CrownService {
  constructor(
    private readonly db: Db,
    private readonly lastfm: LastfmClient,
    private readonly lock: KeyedMutex,
    private readonly onChange: (change: CrownChange) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Fetch every member's playcount and settle the crown. Zero-play members are kept in
   * the listener list (legacy who-knows showed them filtered later); crowns require >0 plays.
   */
  async scan(target: ScanTarget, members: RegisteredMember[]): Promise<ScanResult> {
    const kind: CrownKind = target.albumName === undefined ? 'artist' : 'album';
    const started = this.now();

    let canonicalArtist = target.artistName;
    let canonicalAlbum = target.albumName ?? null;
    let artistUrl: string | null = null;
    let albumUrl: string | null = null;
    let image: string | null = null;

    const listeners: Listener[] = [];
    for (const member of members) {
      try {
        let plays: number;
        if (kind === 'album') {
          const info = await this.lastfm.getAlbumInfo(
            target.artistName,
            target.albumName!,
            member.lastfmUsername,
          );
          plays = toInt(info.album.userplaycount);
          canonicalAlbum = info.album.name;
          canonicalArtist = info.album.artist;
          albumUrl = info.album.url;
          image = highestResImageUrl(info.album.image) || image;
        } else {
          const info = await this.lastfm.getArtistInfo(target.artistName, member.lastfmUsername);
          plays = toInt(info.artist.stats.userplaycount);
          canonicalArtist = info.artist.name;
          artistUrl = info.artist.url;
          image = highestResImageUrl(info.artist.image) || image;
        }
        listeners.push({ ...member, plays });
      } catch (error) {
        // an individual user failing (private profile, deleted account) must not sink the scan
        if (error instanceof LastfmError && !error.retryable) continue;
        throw error;
      }
    }

    listeners.sort((a, b) => b.plays - a.plays);
    const totalPlays = listeners.reduce((sum, l) => sum + l.plays, 0);
    const listenerCount = listeners.filter((l) => l.plays > 0).length;

    const change = await this.lock.run(
      `${kind}:${target.guildId}:${canonicalArtist.toLowerCase()}:${(canonicalAlbum ?? '').toLowerCase()}`,
      () =>
        Promise.resolve(
          this.applyCrown(
            kind,
            {
              guildId: target.guildId,
              guildName: target.guildName,
              artistName: canonicalArtist,
              ...(canonicalAlbum !== null ? { albumName: canonicalAlbum } : {}),
            },
            listeners,
            totalPlays,
            listenerCount,
            { artistUrl, albumUrl, image },
          ),
        ),
    );

    if (change) await this.onChange(change);

    const tookMs = this.now() - started;
    this.db.insert(schema.scanTimings).values({ kind, guildId: target.guildId, ms: tookMs }).run();

    return {
      listeners,
      totalPlays,
      listenerCount,
      change,
      tookMs,
      artistName: canonicalArtist,
      albumName: canonicalAlbum,
      artistUrl,
      albumUrl,
      imageUrl: image,
    };
  }

  private applyCrown(
    kind: CrownKind,
    target: ScanTarget,
    listeners: Listener[],
    totalPlays: number,
    listenerCount: number,
    urls: { artistUrl: string | null; albumUrl: string | null; image: string | null },
  ): CrownChange | null {
    const top = listeners[0];
    if (!top || top.plays <= 0) return null;

    const existing =
      kind === 'artist'
        ? this.db
            .select()
            .from(schema.artistCrowns)
            .where(
              and(
                eq(schema.artistCrowns.guildId, target.guildId),
                eq(schema.artistCrowns.artistName, target.artistName),
              ),
            )
            .get()
        : this.db
            .select()
            .from(schema.albumCrowns)
            .where(
              and(
                eq(schema.albumCrowns.guildId, target.guildId),
                eq(schema.albumCrowns.artistName, target.artistName),
                eq(schema.albumCrowns.albumName, target.albumName!),
              ),
            )
            .get();

    const incumbent = existing ? listeners.find((l) => l.userId === existing.userId) : undefined;

    const prevOwnerId = existing?.userId ?? null;
    const prevPlays = existing
      ? 'artistPlays' in existing
        ? existing.artistPlays
        : existing.albumPlays
      : null;

    // ties go to the incumbent (strict >), so crowns can't flip on equal counts;
    // an incumbent who left the guild or logged out forfeits to the current top
    const finalOwner = incumbent && top.plays <= incumbent.plays ? incumbent : top;
    const finalPlays = finalOwner.plays;

    if (kind === 'artist') {
      const values = {
        guildId: target.guildId,
        userId: finalOwner.userId,
        artistName: target.artistName,
        artistPlays: finalPlays,
        serverPlays: totalPlays,
        serverListeners: listenerCount,
        artistUrl: urls.artistUrl,
        artistImgUrl: urls.image,
        updatedAt: new Date(this.now()),
      };
      if (existing) {
        this.db
          .update(schema.artistCrowns)
          .set(values)
          .where(eq(schema.artistCrowns.id, existing.id))
          .run();
      } else {
        this.db.insert(schema.artistCrowns).values(values).run();
      }
    } else {
      const values = {
        guildId: target.guildId,
        userId: finalOwner.userId,
        artistName: target.artistName,
        albumName: target.albumName!,
        albumPlays: finalPlays,
        serverPlays: totalPlays,
        serverListeners: listenerCount,
        albumUrl: urls.albumUrl,
        updatedAt: new Date(this.now()),
      };
      if (existing) {
        this.db
          .update(schema.albumCrowns)
          .set(values)
          .where(eq(schema.albumCrowns.id, existing.id))
          .run();
      } else {
        this.db.insert(schema.albumCrowns).values(values).run();
      }
    }

    if (prevOwnerId === finalOwner.userId) return null;

    this.db
      .insert(schema.crownAudit)
      .values({
        kind,
        guildId: target.guildId,
        artistName: target.artistName,
        albumName: target.albumName ?? null,
        prevOwnerId,
        newOwnerId: finalOwner.userId,
        prevPlays,
        newPlays: finalPlays,
      })
      .run();

    return {
      kind,
      guildId: target.guildId,
      guildName: target.guildName,
      artistName: target.artistName,
      albumName: target.albumName ?? null,
      prevOwnerId,
      newOwnerId: finalOwner.userId,
      prevPlays,
      newPlays: finalPlays,
    };
  }
}
