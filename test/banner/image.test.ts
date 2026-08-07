import { describe, expect, it } from 'vitest';
import {
  ImageTooLarge,
  MAX_IMAGE_BYTES,
  UnsupportedImageType,
  fetchBannerImage,
  sniffImageType,
} from '../../src/banner/image.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);

function fakeFetch(body: Buffer, headers: Record<string, string> = {}): typeof fetch {
  return (() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(headers),
      arrayBuffer: () =>
        Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
    })) as unknown as typeof fetch;
}

describe('sniffImageType', () => {
  it('identifies the three types Discord accepts', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(GIF)).toBe('image/gif');
  });

  it('rejects anything else, including truncated data', () => {
    expect(sniffImageType(WEBP)).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('fetchBannerImage', () => {
  it('builds a data uri with the sniffed type', async () => {
    const result = await fetchBannerImage('https://i.imgur.com/a.png', {
      fetchImpl: fakeFetch(PNG),
    });
    expect(result.contentType).toBe('image/png');
    expect(result.bytes).toBe(PNG.byteLength);
    expect(result.dataUri).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });

  // discord.js labels every URL-sourced image image/jpg; trusting the header would be no better.
  it('trusts the bytes over a wrong Content-Type header', async () => {
    const result = await fetchBannerImage('https://i.imgur.com/a.jpg', {
      fetchImpl: fakeFetch(PNG, { 'content-type': 'image/jpeg' }),
    });
    expect(result.contentType).toBe('image/png');
  });

  it('rejects an unsupported type', async () => {
    await expect(
      fetchBannerImage('https://i.imgur.com/a.webp', { fetchImpl: fakeFetch(WEBP) }),
    ).rejects.toBeInstanceOf(UnsupportedImageType);
  });

  it('rejects an oversized body', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(64)]);
    await expect(
      fetchBannerImage('https://i.imgur.com/big.png', { fetchImpl: fakeFetch(big), maxBytes: 16 }),
    ).rejects.toBeInstanceOf(ImageTooLarge);
  });

  it('rejects on a declared content-length before downloading', async () => {
    const fetchImpl = fakeFetch(PNG, { 'content-length': String(MAX_IMAGE_BYTES + 1) });
    await expect(
      fetchBannerImage('https://i.imgur.com/big.png', { fetchImpl }),
    ).rejects.toBeInstanceOf(ImageTooLarge);
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = (() =>
      Promise.resolve({
        ok: false,
        status: 403,
        headers: new Headers(),
      })) as unknown as typeof fetch;
    await expect(fetchBannerImage('https://i.imgur.com/a.png', { fetchImpl })).rejects.toThrow(
      /403/,
    );
  });
});
