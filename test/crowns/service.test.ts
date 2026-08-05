import { describe, expect, it } from 'vitest';
import type { LastfmClient } from '../../src/lastfm/client.js';
import { LastfmError } from '../../src/lastfm/errors.js';
import { CrownService } from '../../src/crowns/service.js';
import type { CrownChange, RegisteredMember } from '../../src/crowns/service.js';
import { KeyedMutex } from '../../src/core/mutex.js';
import { createDb, runMigrations, schema } from '../../src/db/index.js';

const GUILD = { guildId: 'g1', guildName: 'Test Guild' };

function member(id: string, lastfm = `lfm-${id}`): RegisteredMember {
  return { userId: id, tag: `${id}#0`, lastfmUsername: lastfm };
}

/** Stubs artist/album info lookups from a map of lastfmUsername -> plays. */
function stubLastfm(plays: Record<string, number>): LastfmClient {
  return {
    getArtistInfo: (artist: string, username: string) =>
      Promise.resolve({
        artist: {
          name: artist,
          url: `https://last.fm/music/${artist}`,
          stats: { listeners: '1', playcount: '1', userplaycount: String(plays[username] ?? 0) },
          image: [],
        },
      }),
    getAlbumInfo: (artist: string, album: string, username: string) =>
      Promise.resolve({
        album: {
          name: album,
          artist,
          url: `https://last.fm/music/${artist}/${album}`,
          userplaycount: plays[username] ?? 0,
          image: [],
        },
      }),
  } as unknown as LastfmClient;
}

function makeService(plays: Record<string, number>) {
  const db = createDb(':memory:');
  runMigrations(db);
  const changes: CrownChange[] = [];
  const service = new CrownService(db, stubLastfm(plays), new KeyedMutex(), async (c) => {
    changes.push(c);
  });
  return { db, service, changes };
}

describe('CrownService artist crowns', () => {
  it('creates a crown for the top listener', async () => {
    const { db, service, changes } = makeService({ 'lfm-a': 10, 'lfm-b': 5 });
    const result = await service.scan({ ...GUILD, artistName: 'Autechre' }, [
      member('a'),
      member('b'),
    ]);

    const crown = db.select().from(schema.artistCrowns).all()[0]!;
    expect(crown.userId).toBe('a');
    expect(crown.artistPlays).toBe(10);
    expect(crown.serverPlays).toBe(15);
    expect(crown.serverListeners).toBe(2);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ prevOwnerId: null, newOwnerId: 'a', newPlays: 10 });
    expect(result.listeners.map((l) => l.userId)).toEqual(['a', 'b']);
  });

  it('does not create a crown when nobody has plays', async () => {
    const { db, service, changes } = makeService({ 'lfm-a': 0, 'lfm-b': 0 });
    await service.scan({ ...GUILD, artistName: 'Autechre' }, [member('a'), member('b')]);
    expect(db.select().from(schema.artistCrowns).all()).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });

  it('transfers when a challenger strictly exceeds the incumbent', async () => {
    const { db, service, changes } = makeService({ 'lfm-a': 10, 'lfm-b': 5 });
    await service.scan({ ...GUILD, artistName: 'Autechre' }, [member('a'), member('b')]);

    const { service: s2, changes: c2 } = (() => {
      const svc = new CrownService(
        db,
        stubLastfm({ 'lfm-a': 10, 'lfm-b': 20 }),
        new KeyedMutex(),
        async (c) => {
          changes.push(c);
        },
      );
      return { service: svc, changes };
    })();
    await s2.scan({ ...GUILD, artistName: 'Autechre' }, [member('a'), member('b')]);

    const crown = db.select().from(schema.artistCrowns).all()[0]!;
    expect(crown.userId).toBe('b');
    expect(crown.artistPlays).toBe(20);
    expect(c2).toHaveLength(2);
    expect(c2[1]).toMatchObject({ prevOwnerId: 'a', newOwnerId: 'b', prevPlays: 10, newPlays: 20 });
  });

  it('ties keep the incumbent', async () => {
    const { db, service } = makeService({ 'lfm-a': 10, 'lfm-b': 5 });
    await service.scan({ ...GUILD, artistName: 'Autechre' }, [member('a'), member('b')]);

    const s2 = new CrownService(
      db,
      stubLastfm({ 'lfm-a': 10, 'lfm-b': 10 }),
      new KeyedMutex(),
      async () => {},
    );
    await s2.scan({ ...GUILD, artistName: 'Autechre' }, [member('a'), member('b')]);

    expect(db.select().from(schema.artistCrowns).all()[0]!.userId).toBe('a');
  });

  it('reassigns when the incumbent left the guild', async () => {
    const { db, service } = makeService({ 'lfm-a': 10, 'lfm-b': 5 });
    await service.scan({ ...GUILD, artistName: 'Autechre' }, [member('a'), member('b')]);

    const s2 = new CrownService(
      db,
      stubLastfm({ 'lfm-b': 5 }),
      new KeyedMutex(),
      async () => {},
    );
    // member a no longer in the member list
    await s2.scan({ ...GUILD, artistName: 'Autechre' }, [member('b')]);

    const crown = db.select().from(schema.artistCrowns).all()[0]!;
    expect(crown.userId).toBe('b');
    expect(crown.artistPlays).toBe(5);
  });

  it('skips members whose lookups fail without sinking the scan', async () => {
    const db = createDb(':memory:');
    runMigrations(db);
    const lastfm = {
      getArtistInfo: (artist: string, username: string) => {
        if (username === 'lfm-bad') {
          return Promise.reject(new LastfmError(6, 'User not found', 'artist.getinfo'));
        }
        return Promise.resolve({
          artist: {
            name: artist,
            url: '',
            stats: { listeners: '1', playcount: '1', userplaycount: '7' },
            image: [],
          },
        });
      },
    } as unknown as LastfmClient;
    const service = new CrownService(db, lastfm, new KeyedMutex(), async () => {});
    const result = await service.scan({ ...GUILD, artistName: 'Autechre' }, [
      member('bad', 'lfm-bad'),
      member('ok'),
    ]);
    expect(result.listeners).toHaveLength(1);
    expect(result.listeners[0]!.userId).toBe('ok');
  });

  it('writes an audit row on every ownership change', async () => {
    const { db, service } = makeService({ 'lfm-a': 3 });
    await service.scan({ ...GUILD, artistName: 'Autechre' }, [member('a')]);
    const audit = db.select().from(schema.crownAudit).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ kind: 'artist', newOwnerId: 'a', prevOwnerId: null });
  });

  it('records scan timings', async () => {
    const { db, service } = makeService({ 'lfm-a': 3 });
    await service.scan({ ...GUILD, artistName: 'Autechre' }, [member('a')]);
    expect(db.select().from(schema.scanTimings).all()).toHaveLength(1);
  });
});

describe('CrownService album crowns', () => {
  it('creates album crowns keyed by artist+album', async () => {
    const { db, service, changes } = makeService({ 'lfm-a': 4 });
    await service.scan({ ...GUILD, artistName: 'Autechre', albumName: 'Confield' }, [member('a')]);

    const crown = db.select().from(schema.albumCrowns).all()[0]!;
    expect(crown.albumName).toBe('Confield');
    expect(crown.albumPlays).toBe(4);
    expect(changes[0]!.kind).toBe('album');
    expect(changes[0]!.albumName).toBe('Confield');
  });

  it('keeps artist and album crowns independent', async () => {
    const { db, service } = makeService({ 'lfm-a': 4 });
    await service.scan({ ...GUILD, artistName: 'Autechre' }, [member('a')]);
    await service.scan({ ...GUILD, artistName: 'Autechre', albumName: 'Confield' }, [member('a')]);
    expect(db.select().from(schema.artistCrowns).all()).toHaveLength(1);
    expect(db.select().from(schema.albumCrowns).all()).toHaveLength(1);
  });
});

describe('CrownService concurrency', () => {
  it('serializes concurrent scans of the same crown so last-writer-wins cannot regress', async () => {
    const db = createDb(':memory:');
    runMigrations(db);
    const mutex = new KeyedMutex();
    let resolveSlow!: () => void;
    const slowGate = new Promise<void>((r) => (resolveSlow = r));

    // slow scan sees old counts; fast scan sees new ones
    const slowLastfm = {
      getArtistInfo: async () => {
        await slowGate;
        return {
          artist: { name: 'X', url: '', stats: { userplaycount: '5' }, image: [] },
        };
      },
    } as unknown as LastfmClient;
    const fastLastfm = {
      getArtistInfo: async () => ({
        artist: { name: 'X', url: '', stats: { userplaycount: '9' }, image: [] },
      }),
    } as unknown as LastfmClient;

    const slow = new CrownService(db, slowLastfm, mutex, async () => {});
    const fast = new CrownService(db, fastLastfm, mutex, async () => {});

    const slowRun = slow.scan({ ...GUILD, artistName: 'X' }, [member('a')]);
    const fastRun = fast.scan({ ...GUILD, artistName: 'X' }, [member('a')]);
    await fastRun;
    resolveSlow();
    await slowRun;

    // the same owner both times; the crown row exists exactly once
    const rows = db.select().from(schema.artistCrowns).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe('a');
  });
});
