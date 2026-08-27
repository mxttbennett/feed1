import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestImageUrl, originalSize } from '../../src/lastfm/types.js';
import type { LastfmImage } from '../../src/lastfm/types.js';

const CDN = 'https://lastfm.freetls.fastly.net/i/u';
const HASH = '02f3dda4fe9195bc5d31c638afbd0471.jpg';

const fixture = (name: string) =>
  JSON.parse(readFileSync(`test/lastfm/fixtures/${name}.json`, 'utf8')) as Record<string, never>;

describe('originalSize', () => {
  it('drops the dimensions segment', () => {
    expect(originalSize(`${CDN}/300x300/${HASH}`)).toBe(`${CDN}/${HASH}`);
    expect(originalSize(`${CDN}/174s/${HASH}`)).toBe(`${CDN}/${HASH}`);
  });

  it('leaves a URL that is already unsized alone', () => {
    expect(originalSize(`${CDN}/${HASH}`)).toBe(`${CDN}/${HASH}`);
  });

  it('leaves URLs from anywhere else untouched', () => {
    const foreign = 'https://example.com/i/u/300x300/cover.jpg';
    expect(originalSize(foreign)).toBe(foreign);
  });
});

describe('bestImageUrl', () => {
  // a distinct hash per size, so the pick is observable after the dimensions are stripped
  const sized = (...sizes: string[]): LastfmImage[] =>
    sizes.map((size) => ({ size, '#text': `${CDN}/300x300/${size}.jpg` }));

  it('prefers the largest named size', () => {
    expect(bestImageUrl(sized('small', 'large', 'mega'))).toBe(`${CDN}/mega.jpg`);
    expect(bestImageUrl(sized('small', 'large', 'extralarge'))).toBe(`${CDN}/extralarge.jpg`);
  });

  it('falls back down the size ladder', () => {
    expect(bestImageUrl(sized('small', 'medium'))).toBe(`${CDN}/medium.jpg`);
  });

  it('takes the first usable entry when no size is recognised', () => {
    expect(bestImageUrl([{ size: 'huge', '#text': `${CDN}/1000x1000/${HASH}` }])).toBe(
      `${CDN}/${HASH}`,
    );
  });

  it('skips entries with a blank URL', () => {
    expect(bestImageUrl([{ size: 'mega', '#text': '' }, ...sized('large')])).toBe(
      `${CDN}/large.jpg`,
    );
  });

  it('returns empty for a missing or empty image set', () => {
    expect(bestImageUrl(undefined)).toBe('');
    expect(bestImageUrl([])).toBe('');
    expect(bestImageUrl([{ size: 'mega', '#text': '' }])).toBe('');
  });

  it('unsizes the real album.getinfo and artist.getinfo payloads', () => {
    const album = fixture('album_getinfo') as unknown as { album: { image: LastfmImage[] } };
    const artist = fixture('artist_getinfo') as unknown as { artist: { image: LastfmImage[] } };
    expect(bestImageUrl(album.album.image)).toBe(`${CDN}/${HASH}`);
    expect(bestImageUrl(artist.artist.image)).toBe(`${CDN}/10ede3abec1bb37ad564a80bed01563d.png`);
  });
});
