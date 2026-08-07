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
 * Content type from the bytes, not the header — CDN edges mislabel, and Discord
 * rejects a data URI whose declared type contradicts its payload.
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

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Dimensions straight from the file header, so a 10 MB image never has to be decoded.
 * Zeroes mean "couldn't tell" — callers treat that as "don't warn", never as an error.
 */
export function readDimensions(data: Uint8Array, contentType: string): ImageDimensions {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  try {
    if (contentType === 'image/png' && data.length >= 24) {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (contentType === 'image/gif' && data.length >= 10) {
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (contentType === 'image/jpeg') {
      // walk the marker chain to the frame header; SOF0-15 carry the size, minus the
      // four markers sharing that range that are not frame headers (DHT, DAC, JPG, DNL)
      let offset = 2;
      while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = data[offset + 1]!;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc, 0xc9].includes(marker)) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + view.getUint16(offset + 2);
      }
    }
  } catch {
    // a truncated or malformed header is not worth failing an upload over
  }
  return { width: 0, height: 0 };
}

export interface LoadedImage {
  data: Uint8Array;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
  animated: boolean;
}

/** Validate and describe raw image bytes. Throws for anything Discord won't take. */
export function inspectImage(
  data: Uint8Array,
  label = 'image',
  maxBytes = MAX_IMAGE_BYTES,
): LoadedImage {
  if (data.byteLength > maxBytes) throw new ImageTooLarge(label);
  const contentType = sniffImageType(data);
  if (!contentType) throw new UnsupportedImageType(label);
  const { width, height } = readDimensions(data, contentType);
  return {
    data,
    contentType,
    bytes: data.byteLength,
    width,
    height,
    animated: contentType === 'image/gif',
  };
}

export interface FetchImageOptions {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

/** Download an image and validate it. Used by `-banner add` for URLs and attachments alike. */
export async function fetchImage(url: string, opts: FetchImageOptions = {}): Promise<LoadedImage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ImageTooLarge(url);

  return inspectImage(new Uint8Array(await res.arrayBuffer()), url, maxBytes);
}

/**
 * Base64 data URI for `Guild#setBanner`.
 *
 * discord.js accepts a URL, but its `resolveImage` drops the fetched content type and
 * labels everything `image/jpg` — so the type has to be declared here, from the bytes.
 */
export function toDataUri(data: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${Buffer.from(data).toString('base64')}`;
}

/** Discord crops off-ratio banners rather than rejecting them, so this only ever warns. */
export function isOffRatio(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return Math.abs(width / height - 16 / 9) > 0.2;
}
