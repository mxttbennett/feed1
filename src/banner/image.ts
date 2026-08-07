export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export class ImageTooLarge extends Error {
  constructor(readonly url: string) {
    super(`image exceeds ${MAX_IMAGE_BYTES} bytes: ${url}`);
    this.name = 'ImageTooLarge';
  }
}

export class UnsupportedImageType extends Error {
  constructor(readonly url: string) {
    super(`not a PNG, JPEG or GIF: ${url}`);
    this.name = 'UnsupportedImageType';
  }
}

/**
 * Content type from the bytes, not the header — Imgur's CDN edges have been known to
 * mislabel, and Discord rejects a data URI whose declared type contradicts its payload.
 */
export function sniffImageType(data: Uint8Array): string | null {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  )
    return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg';
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38
  )
    return 'image/gif';
  return null;
}

export interface FetchedImage {
  dataUri: string;
  contentType: string;
  bytes: number;
}

export interface FetchImageOptions {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Fetch an image and hand back a data URI ready for `Guild#setBanner`.
 *
 * discord.js accepts a bare URL, but its `resolveImage` drops the fetched content type and
 * labels everything `image/jpg`, fetches without a timeout, and has no size cap — so we do
 * the fetch ourselves.
 */
export async function fetchBannerImage(
  url: string,
  opts: FetchImageOptions = {},
): Promise<FetchedImage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image ${url}`);

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ImageTooLarge(url);

  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > maxBytes) throw new ImageTooLarge(url);

  const contentType = sniffImageType(data);
  if (!contentType) throw new UnsupportedImageType(url);

  return {
    dataUri: `data:${contentType};base64,${Buffer.from(data).toString('base64')}`,
    contentType,
    bytes: data.byteLength,
  };
}
