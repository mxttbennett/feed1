import { describe, expect, it } from 'vitest';
import {
  ImageTooLarge,
  MAX_IMAGE_BYTES,
  UnsupportedImageType,
  fetchImage,
  inspectImage,
  isOffRatio,
  readDimensions,
  sniffImageType,
  toDataUri,
} from '../../src/banner/image.js';

/** 1920x1080 PNG header: IHDR width/height are big-endian at bytes 16 and 20. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0x07, 0x80, 0,
  0, 0x04, 0x38,
]);
/**
 * SOI, then a 14-byte APP0 (its length field counts itself), then SOF0 carrying
 * 1920x1080 — height precedes width in a JPEG frame header.
 */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x0e, 0x4a, 0x46, 0x49, 0x46, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xc0,
  0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0x01, 0x22, 0x00,
]);
/** GIF logical screen descriptor: little-endian 1920x1080. */
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x07, 0x38, 0x04]);
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

describe('readDimensions', () => {
  it('reads the header of each supported type', () => {
    expect(readDimensions(PNG, 'image/png')).toEqual({ width: 1920, height: 1080 });
    expect(readDimensions(JPEG, 'image/jpeg')).toEqual({ width: 1920, height: 1080 });
    expect(readDimensions(GIF, 'image/gif')).toEqual({ width: 1920, height: 1080 });
  });

  // dimensions are only used for a cosmetic warning, so unreadable must mean "quiet", not "throw"
  it('returns zeroes rather than throwing on a truncated header', () => {
    expect(readDimensions(PNG.subarray(0, 10), 'image/png')).toEqual({ width: 0, height: 0 });
    expect(readDimensions(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe('isOffRatio', () => {
  it('accepts 16:9 and near-16:9, flags anything else', () => {
    expect(isOffRatio(1920, 1080)).toBe(false);
    expect(isOffRatio(1600, 900)).toBe(false);
    expect(isOffRatio(1024, 768)).toBe(true);
    expect(isOffRatio(1000, 1000)).toBe(true);
  });

  it('stays quiet when dimensions are unknown', () => {
    expect(isOffRatio(0, 0)).toBe(false);
  });
});

describe('inspectImage', () => {
  it('describes a valid image', () => {
    expect(inspectImage(PNG)).toMatchObject({
      contentType: 'image/png',
      bytes: PNG.byteLength,
      width: 1920,
      height: 1080,
      animated: false,
    });
  });

  it('marks gifs animated', () => {
    expect(inspectImage(GIF).animated).toBe(true);
  });

  it('rejects unsupported types and oversized data', () => {
    expect(() => inspectImage(WEBP)).toThrow(UnsupportedImageType);
    expect(() => inspectImage(PNG, 'x', 4)).toThrow(ImageTooLarge);
  });
});

describe('toDataUri', () => {
  // discord.js labels every URL-sourced image image/jpg; declaring the real type is the point
  it('declares the given content type', () => {
    expect(toDataUri(PNG, 'image/png')).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(toDataUri(GIF, 'image/gif')).toMatch(/^data:image\/gif;base64,/);
  });
});

describe('fetchImage', () => {
  it('downloads and validates', async () => {
    const result = await fetchImage('https://example.com/a.png', { fetchImpl: fakeFetch(PNG) });
    expect(result).toMatchObject({ contentType: 'image/png', width: 1920, bytes: PNG.byteLength });
  });

  it('trusts the bytes over a wrong Content-Type header', async () => {
    const result = await fetchImage('https://example.com/a.jpg', {
      fetchImpl: fakeFetch(PNG, { 'content-type': 'image/jpeg' }),
    });
    expect(result.contentType).toBe('image/png');
  });

  it('rejects an unsupported type', async () => {
    await expect(
      fetchImage('https://example.com/a.webp', { fetchImpl: fakeFetch(WEBP) }),
    ).rejects.toBeInstanceOf(UnsupportedImageType);
  });

  it('rejects an oversized body', async () => {
    await expect(
      fetchImage('https://example.com/big.png', { fetchImpl: fakeFetch(PNG), maxBytes: 4 }),
    ).rejects.toBeInstanceOf(ImageTooLarge);
  });

  it('rejects on a declared content-length before downloading', async () => {
    const fetchImpl = fakeFetch(PNG, { 'content-length': String(MAX_IMAGE_BYTES + 1) });
    await expect(fetchImage('https://example.com/big.png', { fetchImpl })).rejects.toBeInstanceOf(
      ImageTooLarge,
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = (() =>
      Promise.resolve({
        ok: false,
        status: 403,
        headers: new Headers(),
      })) as unknown as typeof fetch;
    await expect(fetchImage('https://example.com/a.png', { fetchImpl })).rejects.toThrow(/403/);
  });
});
