const BASE = 'https://rateyourmusic.com/charts/top/album,ep,comp,mixtape,djmix/all-time/';

/** RYM genre slugs are lowercase and hyphenated, with the hyphen URL-encoded. */
export function genreSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '%2d')
    .replace(/^(?:%2d)+|(?:%2d)+$/g, '');
}

export interface ServerChartOptions {
  usernames: string[];
  genre?: string;
  excludeRated?: boolean;
  keepSoundtracks?: boolean;
}

/** Segment order is load-bearing — RYM 404s a chart whose filters are shuffled. */
export function buildServerChartUrl(opts: ServerChartOptions): string {
  const segments = [];
  if (opts.genre) segments.push(`g:${genreSlug(opts.genre)}`);
  segments.push(`u:${opts.usernames.join(',')}`);
  if (!opts.keepSoundtracks) segments.push('deweight:soundtrack');
  if (opts.excludeRated) segments.push('excl:ratings');
  return BASE + segments.map((s) => `${s}/`).join('');
}

export interface ServerChartArgs {
  genre?: string;
  excludeRated: boolean;
  keepSoundtracks: boolean;
  /** set when the input can't be honoured; the caller replies with usage instead */
  error?: string;
}

const GENRE_FLAGS = new Set(['-g', '--genre']);

export function parseServerChartArgs(args: string[]): ServerChartArgs {
  const parsed: ServerChartArgs = { excludeRated: false, keepSoundtracks: false };
  const genreWords: string[] = [];
  let collectingGenre = false;

  for (const arg of args) {
    const flag = arg.toLowerCase();
    if (GENRE_FLAGS.has(flag)) {
      if (genreWords.length > 0 || collectingGenre) {
        return { ...parsed, error: 'you can only give one genre.' };
      }
      collectingGenre = true;
      continue;
    }
    if (flag === '--exclude-rated' || flag === '--excl') {
      collectingGenre = false;
      parsed.excludeRated = true;
      continue;
    }
    if (flag === '--soundtracks') {
      collectingGenre = false;
      parsed.keepSoundtracks = true;
      continue;
    }
    if (arg.startsWith('-')) return { ...parsed, error: `I don't know the \`${arg}\` option.` };
    if (!collectingGenre) return { ...parsed, error: `I don't know what \`${arg}\` means here.` };
    genreWords.push(arg);
  }

  if (collectingGenre && genreWords.length === 0) {
    return { ...parsed, error: 'that genre flag needs a genre after it.' };
  }
  if (genreWords.length > 0) parsed.genre = genreWords.join(' ');
  return parsed;
}
