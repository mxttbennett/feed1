import { describe, expect, it } from 'vitest';
import { createDb, runMigrations, schema } from '../../src/db/index.js';

function freshDb() {
  const db = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('schema', () => {
  it('applies migrations to a fresh database', () => {
    const db = freshDb();
    expect(db.select().from(schema.users).all()).toEqual([]);
  });

  it('enforces one crown per guild+artist', () => {
    const db = freshDb();
    const row = { guildId: 'g1', userId: 'u1', artistName: 'Autechre', artistPlays: 100 };
    db.insert(schema.artistCrowns).values(row).run();
    expect(() =>
      db
        .insert(schema.artistCrowns)
        .values({ ...row, userId: 'u2' })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it('enforces one album crown per guild+artist+album', () => {
    const db = freshDb();
    const row = {
      guildId: 'g1',
      userId: 'u1',
      artistName: 'Autechre',
      albumName: 'Confield',
      albumPlays: 50,
    };
    db.insert(schema.albumCrowns).values(row).run();
    expect(() => db.insert(schema.albumCrowns).values(row).run()).toThrow(/UNIQUE/);
    db.insert(schema.albumCrowns)
      .values({ ...row, albumName: 'Tri Repetae' })
      .run();
  });

  it('dedupes crown jobs including artist jobs with defaulted album', () => {
    const db = freshDb();
    const job = {
      kind: 'artist' as const,
      guildId: 'g1',
      artistName: 'Autechre',
      requestedBy: 'u1',
    };
    db.insert(schema.crownJobs).values(job).run();
    expect(() => db.insert(schema.crownJobs).values(job).run()).toThrow(/UNIQUE/);
  });

  it('allows only one banner config per guild', () => {
    const db = freshDb();
    const row = { guildId: 'g1', intervalMinutes: 60, nextRunAt: new Date(0), setBy: 'u1' };
    db.insert(schema.bannerConfigs).values(row).run();
    expect(() =>
      db
        .insert(schema.bannerConfigs)
        .values({ ...row, intervalMinutes: 120 })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it('allows the same image in two guilds but not twice in one', () => {
    const db = freshDb();
    const row = {
      guildId: 'g1',
      sha256: 'abc',
      contentType: 'image/png',
      bytes: 100,
      addedBy: 'u1',
    };
    db.insert(schema.bannerImages).values(row).run();
    expect(() => db.insert(schema.bannerImages).values(row).run()).toThrow(/UNIQUE/);
    db.insert(schema.bannerImages)
      .values({ ...row, guildId: 'g2' })
      .run();
  });

  it('stores numeric playcounts as integers', () => {
    const db = freshDb();
    db.insert(schema.artistCrowns)
      .values({ guildId: 'g1', userId: 'u1', artistName: 'a', artistPlays: 42 })
      .run();
    const crown = db.select().from(schema.artistCrowns).all()[0];
    expect(crown?.artistPlays).toBe(42);
    expect(typeof crown?.artistPlays).toBe('number');
  });
});
