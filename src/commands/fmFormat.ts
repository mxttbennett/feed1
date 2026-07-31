/** Pure formatting helpers for &fm, preserving legacy output byte-for-byte. */

export const LOADING_GIF = 'https://i.imgur.com/tOuSBYf.gif';
export const CROWN_GIF_DEFAULT = 'https://i.imgur.com/GBuQOhn.gif';
export const CROWN_GIF_OWN = 'https://i.imgur.com/bCeKwDd.gif';
export const CROWN_GIF_OTHER = 'https://i.imgur.com/Qgo8myA.gif';

export const NOT_PLAYING_FOOTER =
  'cannot fetch currently playing track.\nthis is the last track scrobbled.';
export const LASTFM_DOWN_REPLY =
  'an error occurred. Last.fm may be experiencing issues at the moment.';

/** Legacy markdown guard: `*` in names becomes the literal string `&ast`. */
export function escapeAsterisks(name: string): string {
  return name.split('*').join('&ast');
}

export function rymArtistSearchUrl(artist: string): string {
  return (
    'https://www.google.com/search?q=' +
    encodeURIComponent(artist) +
    '%20artist%20songs%20discography%20biography' +
    '%20site%3Arateyourmusic.com/artist/'
  );
}

export function rymAlbumSearchUrl(artist: string, album: string): string {
  return (
    'https://www.google.com/search?q=' +
    encodeURIComponent(artist) +
    '%20' +
    encodeURIComponent(album) +
    '%20release%20reviews%20ratings' +
    '%20site%3Arateyourmusic.com%2Frelease%2F'
  );
}

export function fmDescription(artist: string, album: string): string {
  const art = rymArtistSearchUrl(artist);
  const artistLine = `[**${escapeAsterisks(artist)}**]( ${art} 'search rym for ${artist} ')`;
  const albumLine = album
    ? `[***${escapeAsterisks(album)}***](${rymAlbumSearchUrl(artist, album)} 'search rym for ${artist} - ${album}')`
    : `[no album]`;
  return `${artistLine}\n${albumLine}`;
}

/** `scrobbles → all: N | artist: N | album: N`, omitting empty/zero segments. */
export function scrobblesFooter(
  all: number,
  artistPlays: number | null,
  albumPlays: number | null,
): string {
  let foot = `scrobbles → all: ${all}`;
  if (artistPlays !== null && artistPlays > 0) {
    foot += ` | artist: ${artistPlays}`;
    if (albumPlays !== null && albumPlays > 0) foot += ` | album: ${albumPlays}`;
  }
  return foot;
}

export interface Ranks {
  week: number | null;
  month: number | null;
  year: number | null;
  overall: number | null;
}

/**
 * `\n<kind> ranks → w: #N | m: #N | y: #N | o: #N` for the ranks that were found.
 * Legacy quirk kept: when only the overall rank exists the label is singular (`album rank`).
 */
export function rankLine(ranks: Ranks, kind: 'artist' | 'album'): string {
  const segments: string[] = [];
  if (ranks.week !== null) segments.push(`w: #${ranks.week}`);
  if (ranks.month !== null) segments.push(`m: #${ranks.month}`);
  if (ranks.year !== null) segments.push(`y: #${ranks.year}`);
  if (ranks.overall !== null) segments.push(`o: #${ranks.overall}`);
  if (segments.length === 0) return '';
  const onlyOverall = segments.length === 1 && ranks.overall !== null;
  return `\n${kind} rank${onlyOverall ? '' : 's'} → ${segments.join(' | ')}`;
}
