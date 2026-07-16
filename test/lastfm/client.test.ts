import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LastfmClient } from '../../src/lastfm/client.js';
import { LastfmError } from '../../src/lastfm/errors.js';
import { RateLimiter } from '../../src/lastfm/rateLimiter.js';
import { imageUrl, toInt } from '../../src/lastfm/types.js';

const BASE = 'https://ws.audioscrobbler.com';

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

function makeClient() {
  return new LastfmClient('test-key', { minIntervalMs: 0, sleep: async () => {} });
}

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());

describe('LastfmClient', () => {
  it('fetches and types user info', async () => {
    nock(BASE).get('/2.0/').query(true).reply(200, fixture('user_getinfo'));
    const info = await makeClient().getUserInfo('rj');
    expect(info.user.name).toBe('RJ');
    expect(toInt(info.user.playcount)).toBeGreaterThan(100_000);
  });

  it('detects now playing vs last scrobbled', async () => {
    const recent = fixture('user_getrecenttracks');
    nock(BASE).get('/2.0/').query(true).reply(200, recent);
    const np = await makeClient().getNowPlaying('rj');
    // recorded fixture has no nowplaying attr — should be null
    expect(np).toBeNull();

    const withNp = JSON.parse(JSON.stringify(recent)) as {
      recenttracks: { track: Record<string, unknown>[] };
    };
    withNp.recenttracks.track[0]!['@attr'] = { nowplaying: 'true' };
    nock(BASE).get('/2.0/').query(true).reply(200, withNp);
    const playing = await makeClient().getNowPlaying('rj');
    expect(playing?.name).toBe('Private Idaho');
    expect(imageUrl(playing?.image, 2)).toContain('174s');
  });

  it('parses top albums/artists/tracks', async () => {
    nock(BASE).get('/2.0/').query(true).reply(200, fixture('user_gettopalbums'));
    const albums = await makeClient().getTopAlbums('rj', '7day', 3);
    const first = albums.topalbums.album[0]!;
    expect(first.name).toBeTruthy();
    expect(first.artist.name).toBeTruthy();
    expect(toInt(first.playcount)).toBeGreaterThan(0);

    nock(BASE).get('/2.0/').query(true).reply(200, fixture('user_gettopartists'));
    const artists = await makeClient().getTopArtists('rj', '7day', 3);
    expect(artists.topartists.artist[0]!.name).toBeTruthy();

    nock(BASE).get('/2.0/').query(true).reply(200, fixture('user_gettoptracks'));
    const tracks = await makeClient().getTopTracks('rj', '7day', 3);
    expect(tracks.toptracks.track[0]!.artist.name).toBeTruthy();
  });

  it('exposes per-user playcounts on artist and album info', async () => {
    nock(BASE).get('/2.0/').query(true).reply(200, fixture('artist_getinfo'));
    const artist = await makeClient().getArtistInfo('Autechre', 'rj');
    expect(artist.artist.name).toBe('Autechre');
    expect(artist.artist.stats.userplaycount).toBeDefined();

    nock(BASE).get('/2.0/').query(true).reply(200, fixture('album_getinfo'));
    const album = await makeClient().getAlbumInfo('Autechre', 'Confield', 'rj');
    expect(album.album.name).toBe('Confield');
    expect(toInt(album.album.userplaycount)).toBeGreaterThanOrEqual(0);
  });

  it('throws typed non-retryable error for unknown user', async () => {
    nock(BASE).get('/2.0/').query(true).reply(404, fixture('error_user_not_found'));
    const err = await makeClient().getUserInfo('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LastfmError);
    expect((err as LastfmError).code).toBe(6);
    expect((err as LastfmError).notFound).toBe(true);
    expect((err as LastfmError).retryable).toBe(false);
  });

  it('retries retryable codes with backoff then succeeds', async () => {
    nock(BASE)
      .get('/2.0/')
      .query(true)
      .reply(500, { error: 29, message: 'Rate limit exceeded' })
      .get('/2.0/')
      .query(true)
      .reply(200, fixture('user_getinfo'));
    const info = await makeClient().getUserInfo('rj');
    expect(info.user.name).toBe('RJ');
  });

  it('gives up after maxRetries on persistent retryable errors', async () => {
    nock(BASE).get('/2.0/').query(true).times(3).reply(500, { error: 8, message: 'Backend' });
    const client = new LastfmClient('k', {
      minIntervalMs: 0,
      maxRetries: 2,
      sleep: async () => {},
    });
    await expect(client.getUserInfo('rj')).rejects.toMatchObject({ code: 8 });
  });

  it('treats network failures as retryable', async () => {
    nock(BASE)
      .get('/2.0/')
      .query(true)
      .replyWithError('connection reset')
      .get('/2.0/')
      .query(true)
      .reply(200, fixture('user_getinfo'));
    const info = await makeClient().getUserInfo('rj');
    expect(info.user.name).toBe('RJ');
  });
});

describe('RateLimiter', () => {
  it('spaces acquisitions by the minimum interval', async () => {
    const sleeps: number[] = [];
    let clock = 0;
    const limiter = new RateLimiter(250, {
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(sleeps).toEqual([250, 250]);
  });
});
