import { LastfmError } from './errors.js';
import { RateLimiter } from './rateLimiter.js';
import type {
  AlbumInfo,
  ArtistInfo,
  Period,
  RecentTrack,
  RecentTracks,
  TopAlbums,
  TopArtists,
  TopTracks,
  UserInfo,
} from './types.js';

export interface LastfmClientOptions {
  baseUrl?: string;
  /** minimum spacing between requests; default 250ms (~4 req/s) */
  minIntervalMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class LastfmClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: RateLimiter;

  constructor(
    private readonly apiKey: string,
    opts: LastfmClientOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? 'https://ws.audioscrobbler.com/2.0/';
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 1000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limiter = new RateLimiter(opts.minIntervalMs ?? 250, { sleep: this.sleep });
  }

  private async request<T>(method: string, params: Record<string, string>): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt++;
      await this.limiter.acquire();
      let error: LastfmError;
      try {
        const url = new URL(this.baseUrl);
        url.searchParams.set('method', method);
        url.searchParams.set('api_key', this.apiKey);
        url.searchParams.set('format', 'json');
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

        const res = await this.fetchImpl(url);
        const body: unknown = await res.json().catch(() => undefined);
        const apiError =
          typeof body === 'object' && body !== null && 'error' in body
            ? (body as { error: number; message?: string })
            : undefined;

        if (!apiError && res.ok && body !== undefined) return body as T;
        error = apiError
          ? new LastfmError(apiError.error, apiError.message ?? 'Unknown Last.fm error', method)
          : new LastfmError(8, `HTTP ${res.status} from Last.fm`, method);
      } catch (cause) {
        error = new LastfmError(8, `Network error calling Last.fm: ${String(cause)}`, method);
      }

      if (!error.retryable || attempt > this.maxRetries) throw error;
      await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
    }
  }

  getUserInfo(user: string): Promise<UserInfo> {
    return this.request('user.getinfo', { user });
  }

  getRecentTracks(
    user: string,
    opts: { limit?: number; page?: number; from?: number; to?: number } = {},
  ): Promise<RecentTracks> {
    const params: Record<string, string> = { user };
    if (opts.limit !== undefined) params.limit = String(opts.limit);
    if (opts.page !== undefined) params.page = String(opts.page);
    if (opts.from !== undefined) params.from = String(opts.from);
    if (opts.to !== undefined) params.to = String(opts.to);
    return this.request('user.getrecenttracks', params);
  }

  /** The currently playing track, or null when nothing is scrobbling right now. */
  async getNowPlaying(user: string): Promise<RecentTrack | null> {
    const data = await this.getRecentTracks(user, { limit: 1 });
    const track = data.recenttracks.track[0];
    return track?.['@attr']?.nowplaying ? track : null;
  }

  getTopAlbums(user: string, period: Period, limit = 50, page = 1): Promise<TopAlbums> {
    return this.request('user.gettopalbums', {
      user,
      period,
      limit: String(limit),
      page: String(page),
    });
  }

  getTopTracks(user: string, period: Period, limit = 50, page = 1): Promise<TopTracks> {
    return this.request('user.gettoptracks', {
      user,
      period,
      limit: String(limit),
      page: String(page),
    });
  }

  getTopArtists(user: string, period: Period, limit = 50, page = 1): Promise<TopArtists> {
    return this.request('user.gettopartists', {
      user,
      period,
      limit: String(limit),
      page: String(page),
    });
  }

  getArtistInfo(artist: string, username?: string): Promise<ArtistInfo> {
    // autocorrect maps variants ("the grateful dead") to the canonical artist
    // ("Grateful Dead") so crowns key on one name instead of splitting.
    const params: Record<string, string> = { artist, autocorrect: '1' };
    if (username !== undefined) params.username = username;
    return this.request('artist.getinfo', params);
  }

  getAlbumInfo(artist: string, album: string, username?: string): Promise<AlbumInfo> {
    const params: Record<string, string> = { artist, album, autocorrect: '1' };
    if (username !== undefined) params.username = username;
    return this.request('album.getinfo', params);
  }
}
