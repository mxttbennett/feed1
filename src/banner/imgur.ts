import { RateLimiter } from '../lastfm/rateLimiter.js';

export class ImgurError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ImgurError';
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }

  get notFound(): boolean {
    return this.status === 404 || this.status === 403;
  }
}

export interface ImgurImage {
  id: string;
  link: string;
  type: string;
  animated: boolean;
  width: number;
  height: number;
  size: number;
}

const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);

/**
 * Pull the album hash out of anything a user is likely to paste. Imgur's slugged
 * form (`/a/some-title-AbCdEfG`) puts the hash last, so the trailing segment wins.
 */
export function parseAlbumRef(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9]{5,10}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/(^|\.)imgur\.com$/i.test(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const kind = segments[0]?.toLowerCase();
  if (kind !== 'a' && kind !== 'gallery') return null;

  const last = segments[segments.length - 1];
  if (!last) return null;
  const hash = last.includes('-') ? last.slice(last.lastIndexOf('-') + 1) : last;
  return /^[A-Za-z0-9]{5,10}$/.test(hash) ? hash : null;
}

export interface ImgurClientOptions {
  baseUrl?: string;
  minIntervalMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class ImgurClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: RateLimiter;

  constructor(
    private readonly clientId: string,
    opts: ImgurClientOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? 'https://api.imgur.com/3/';
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 1000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limiter = new RateLimiter(opts.minIntervalMs ?? 1000, { sleep: this.sleep });
  }

  /** Images in an album, filtered to the types Discord accepts as a banner. */
  async fetchAlbumImages(albumHash: string): Promise<ImgurImage[]> {
    const body = await this.request<{ data?: unknown }>(`album/${albumHash}/images`);
    const raw = Array.isArray(body.data) ? body.data : [];
    return raw
      .map((item) => this.toImage(item))
      .filter((img): img is ImgurImage => img !== null && SUPPORTED_TYPES.has(img.type));
  }

  private toImage(item: unknown): ImgurImage | null {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>;
    if (typeof o.link !== 'string' || typeof o.type !== 'string') return null;
    return {
      id: typeof o.id === 'string' ? o.id : o.link,
      link: o.link,
      type: o.type.toLowerCase(),
      animated: o.animated === true,
      width: typeof o.width === 'number' ? o.width : 0,
      height: typeof o.height === 'number' ? o.height : 0,
      size: typeof o.size === 'number' ? o.size : 0,
    };
  }

  private async request<T>(path: string): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt++;
      await this.limiter.acquire();
      let error: ImgurError;
      try {
        const res = await this.fetchImpl(new URL(path, this.baseUrl), {
          headers: { Authorization: `Client-ID ${this.clientId}` },
        });
        if (res.ok) return (await res.json()) as T;
        error = new ImgurError(res.status, `HTTP ${res.status} from Imgur on ${path}`);
      } catch (cause) {
        error = new ImgurError(0, `Network error calling Imgur: ${String(cause)}`);
      }

      if (!error.retryable || attempt > this.maxRetries) throw error;
      await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
    }
  }
}
