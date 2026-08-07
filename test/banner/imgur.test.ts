import { describe, expect, it } from 'vitest';
import nock from 'nock';
import { ImgurClient, ImgurError, parseAlbumRef } from '../../src/banner/imgur.js';

const API = 'https://api.imgur.com';

function client(overrides = {}) {
  return new ImgurClient('test-id', {
    minIntervalMs: 0,
    sleep: async () => {},
    retryBaseDelayMs: 0,
    ...overrides,
  });
}

function image(over: Record<string, unknown> = {}) {
  return {
    id: 'img1',
    link: 'https://i.imgur.com/img1.png',
    type: 'image/png',
    animated: false,
    width: 1920,
    height: 1080,
    size: 1234,
    ...over,
  };
}

describe('parseAlbumRef', () => {
  it('accepts every shape a user is likely to paste', () => {
    expect(parseAlbumRef('https://imgur.com/a/AbCdEfG')).toBe('AbCdEfG');
    expect(parseAlbumRef('https://imgur.com/a/AbCdEfG/')).toBe('AbCdEfG');
    expect(parseAlbumRef('https://imgur.com/gallery/AbCdEfG')).toBe('AbCdEfG');
    expect(parseAlbumRef('http://www.imgur.com/a/AbCdEfG?foo=1')).toBe('AbCdEfG');
    expect(parseAlbumRef('  https://imgur.com/a/AbCdEfG  ')).toBe('AbCdEfG');
    expect(parseAlbumRef('AbCdEfG')).toBe('AbCdEfG');
  });

  it('takes the trailing segment of a slugged album url', () => {
    expect(parseAlbumRef('https://imgur.com/a/my-cool-banners-Xy12Zq')).toBe('Xy12Zq');
  });

  it('rejects anything that is not an imgur album', () => {
    expect(parseAlbumRef('https://example.com/a/AbCdEfG')).toBeNull();
    expect(parseAlbumRef('https://imgur.com/AbCdEfG')).toBeNull();
    expect(parseAlbumRef('https://notimgur.com/a/AbCdEfG')).toBeNull();
    expect(parseAlbumRef('not a url at all')).toBeNull();
    expect(parseAlbumRef('https://imgur.com/a/')).toBeNull();
  });
});

describe('ImgurClient.fetchAlbumImages', () => {
  it('sends the Client-ID header and maps the payload', async () => {
    nock(API)
      .get('/3/album/abc/images')
      .matchHeader('authorization', 'Client-ID test-id')
      .reply(200, {
        data: [image(), image({ id: 'img2', link: 'b.gif', type: 'image/gif', animated: true })],
      });

    const images = await client().fetchAlbumImages('abc');
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      id: 'img1',
      type: 'image/png',
      animated: false,
      width: 1920,
    });
    expect(images[1]).toMatchObject({ type: 'image/gif', animated: true });
  });

  it('drops entries Discord cannot use as a banner', async () => {
    nock(API)
      .get('/3/album/abc/images')
      .reply(200, {
        data: [
          image(),
          image({ id: 'v', link: 'v.mp4', type: 'video/mp4' }),
          image({ id: 'w', link: 'w.webp', type: 'image/webp' }),
          { nonsense: true },
        ],
      });

    const images = await client().fetchAlbumImages('abc');
    expect(images.map((i) => i.id)).toEqual(['img1']);
  });

  it('returns an empty list for an album with no images', async () => {
    nock(API).get('/3/album/abc/images').reply(200, { data: [] });
    expect(await client().fetchAlbumImages('abc')).toEqual([]);
  });

  it('throws a notFound error for a private or deleted album', async () => {
    nock(API)
      .get('/3/album/gone/images')
      .reply(404, { data: { error: 'not found' } });
    const error = await client()
      .fetchAlbumImages('gone')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImgurError);
    expect((error as ImgurError).notFound).toBe(true);
    expect((error as ImgurError).retryable).toBe(false);
  });

  it('retries a 429 and succeeds', async () => {
    nock(API).get('/3/album/abc/images').reply(429, {});
    nock(API)
      .get('/3/album/abc/images')
      .reply(200, { data: [image()] });

    const images = await client().fetchAlbumImages('abc');
    expect(images).toHaveLength(1);
  });

  it('gives up after maxRetries on a persistent 500', async () => {
    nock(API).get('/3/album/abc/images').times(3).reply(500, {});
    const error = await client({ maxRetries: 2 })
      .fetchAlbumImages('abc')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImgurError);
    expect((error as ImgurError).status).toBe(500);
  });
});
