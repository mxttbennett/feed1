import { describe, expect, it } from 'vitest';
import {
  buildServerChartUrl,
  genreSlug,
  parseServerChartArgs,
} from '../../src/commands/rymChart.js';

const USERS = ['Accel', 'feastgood', 'grammatizator'];

describe('genreSlug', () => {
  it('lowercases and encodes the separating hyphen', () => {
    expect(genreSlug('Nature Recordings')).toBe('nature%2drecordings');
  });

  it('treats an already-hyphenated genre the same as a spaced one', () => {
    expect(genreSlug('trip-hop')).toBe('trip%2dhop');
    expect(genreSlug('Trip Hop')).toBe('trip%2dhop');
  });

  it('collapses runs of punctuation and trims the edges', () => {
    expect(genreSlug('  drum & bass  ')).toBe('drum%2dbass');
  });
});

describe('buildServerChartUrl', () => {
  const base = 'https://rateyourmusic.com/charts/top/album,ep,comp,mixtape,djmix/all-time/';

  it('deweights soundtracks by default', () => {
    expect(buildServerChartUrl({ usernames: USERS })).toBe(
      `${base}u:Accel,feastgood,grammatizator/deweight:soundtrack/`,
    );
  });

  it('appends excl:ratings after the deweight segment', () => {
    expect(buildServerChartUrl({ usernames: USERS, excludeRated: true })).toBe(
      `${base}u:Accel,feastgood,grammatizator/deweight:soundtrack/excl:ratings/`,
    );
  });

  it('puts the genre segment before the user segment', () => {
    expect(
      buildServerChartUrl({
        usernames: USERS,
        genre: 'Nature Recordings',
        excludeRated: true,
      }),
    ).toBe(
      `${base}g:nature%2drecordings/u:Accel,feastgood,grammatizator/` +
        `deweight:soundtrack/excl:ratings/`,
    );
  });

  it('drops the deweight segment when soundtracks are kept', () => {
    expect(buildServerChartUrl({ usernames: USERS, keepSoundtracks: true })).toBe(
      `${base}u:Accel,feastgood,grammatizator/`,
    );
  });
});

describe('parseServerChartArgs', () => {
  it('defaults to no genre, ratings included, soundtracks deweighted', () => {
    expect(parseServerChartArgs([])).toEqual({
      excludeRated: false,
      keepSoundtracks: false,
    });
  });

  it('reads a multi-word genre without quoting', () => {
    expect(parseServerChartArgs(['-g', 'nature', 'recordings'])).toEqual({
      genre: 'nature recordings',
      excludeRated: false,
      keepSoundtracks: false,
    });
  });

  it('accepts flags in any order and stops the genre at the next flag', () => {
    expect(
      parseServerChartArgs(['--exclude-rated', '--genre', 'trip', 'hop', '--soundtracks']),
    ).toEqual({
      genre: 'trip hop',
      excludeRated: true,
      keepSoundtracks: true,
    });
  });

  it('is case-insensitive about flag names', () => {
    expect(parseServerChartArgs(['--Exclude-Rated']).excludeRated).toBe(true);
  });

  it('errors when the genre flag has nothing after it', () => {
    expect(parseServerChartArgs(['--genre']).error).toBeDefined();
  });

  it('errors on an unknown flag', () => {
    expect(parseServerChartArgs(['--top-2024']).error).toBeDefined();
  });

  it('errors on a bare argument that is not part of a genre', () => {
    expect(parseServerChartArgs(['jazz']).error).toBeDefined();
  });
});
