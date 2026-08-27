/**
 * Raw Last.fm JSON shapes, limited to the fields feed1 consumes.
 * Numeric values arrive as strings; parse at the call site with toInt().
 */

export interface LastfmImage {
  size: string;
  '#text': string;
}

export interface UserInfo {
  user: {
    name: string;
    playcount: string;
    url: string;
    registered: { unixtime: string };
    image: LastfmImage[];
  };
}

export interface RecentTrack {
  name: string;
  artist: { '#text': string; mbid: string };
  album: { '#text': string; mbid: string };
  image: LastfmImage[];
  url: string;
  '@attr'?: { nowplaying: string };
  date?: { uts: string; '#text': string };
}

export interface RecentTracks {
  recenttracks: {
    track: RecentTrack[];
    '@attr': { total: string; user: string };
  };
}

export interface TopAlbum {
  name: string;
  playcount: string;
  artist: { name: string; url: string };
  image: LastfmImage[];
  url: string;
}

export interface TopAlbums {
  topalbums: { album: TopAlbum[]; '@attr': { total: string } };
}

export interface TopTrack {
  name: string;
  playcount: string;
  artist: { name: string; url: string };
}

export interface TopTracks {
  toptracks: { track: TopTrack[]; '@attr': { total: string } };
}

export interface TopArtist {
  name: string;
  playcount: string;
  url: string;
}

export interface TopArtists {
  topartists: { artist: TopArtist[]; '@attr': { total: string } };
}

export interface ArtistInfo {
  artist: {
    name: string;
    url: string;
    stats: { listeners: string; playcount: string; userplaycount?: string };
    image: LastfmImage[];
  };
}

export interface AlbumInfo {
  album: {
    name: string;
    artist: string;
    url: string;
    userplaycount?: number | string;
    playcount?: number | string;
    image: LastfmImage[];
  };
}

export type Period = '7day' | '1month' | '3month' | '6month' | '12month' | 'overall';

/** Last.fm returns counts as strings (and occasionally numbers); normalize safely. */
export function toInt(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Image URL at a given size index, matching legacy `image[i]['#text']` access. */
export function imageUrl(images: LastfmImage[] | undefined, sizeIndex: number): string {
  return images?.[sizeIndex]?.['#text'] ?? '';
}

const SIZE_PREFERENCE = ['mega', 'extralarge', 'large', 'medium', 'small'];

/**
 * Last.fm serves every image off one hash with the dimensions as a path segment
 * (`/i/u/300x300/<hash>.jpg`); dropping the segment yields the original upload, which is
 * far larger than the 300x300 that `extralarge` and `mega` both point at.
 */
export function originalSize(url: string): string {
  return url.replace(/^(https:\/\/lastfm\.freetls\.fastly\.net\/i\/u\/)[^/]+\/([^/]+)$/, '$1$2');
}

/** Highest-resolution URL available for an image set, or '' when there is none. */
export function highestResImageUrl(images: LastfmImage[] | undefined): string {
  if (!images?.length) return '';
  const named = new Map(images.filter((i) => i['#text']).map((i) => [i.size, i['#text']]));
  const highest =
    SIZE_PREFERENCE.map((size) => named.get(size)).find(Boolean) ?? [...named.values()][0];
  return highest ? originalSize(highest) : '';
}
