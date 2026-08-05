import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, runMigrations, schema } from '../../src/db/index.js';

/**
 * A migrations folder holding only the entries up to and including `upToIdx`, so a
 * test can stand up an older schema and then migrate forward across it.
 */
function migrationsFolderUpTo(upToIdx: number): string {
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  const entries = journal.entries.filter((e) => e.idx <= upToIdx);
  const dir = mkdtempSync(join(tmpdir(), 'feed1-migrations-'));
  mkdirSync(join(dir, 'meta'));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) {
    copyFileSync(`drizzle/${entry.tag}.sql`, join(dir, `${entry.tag}.sql`));
  }
  return dir;
}

describe('0001 rename crowns -> artist_crowns', () => {
  // the migrator applies by created_at and never compares the stored hash, so a reused
  // database would silently skip 0001 and pass this suite vacuously
  function dbAtMigration0000() {
    const db = createDb(':memory:');
    runMigrations(db, migrationsFolderUpTo(0));
    return db;
  }

  it('carries existing crowns across the rename', () => {
    const db = dbAtMigration0000();
    db.run(
      sql`insert into crowns (guild_id, user_id, artist_name, artist_plays, server_plays, server_listeners)
          values ('g1', 'u1', 'Autechre', 100, 250, 3), ('g1', 'u2', 'Boards of Canada', 40, 90, 2)`,
    );

    runMigrations(db);

    const rows = db.select().from(schema.artistCrowns).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.artistName, r.userId, r.artistPlays, r.serverPlays])).toEqual([
      ['Autechre', 'u1', 100, 250],
      ['Boards of Canada', 'u2', 40, 90],
    ]);
  });

  it('leaves no crowns table behind', () => {
    const db = dbAtMigration0000();
    runMigrations(db);

    const tables = db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map((r) => r.name);
    expect(tables).toContain('artist_crowns');
    expect(tables).not.toContain('crowns');
    expect(tables).toContain('album_crowns');
  });

  it('keeps the guild+artist uniqueness constraint after the index is rebuilt', () => {
    const db = dbAtMigration0000();
    db.run(
      sql`insert into crowns (guild_id, user_id, artist_name, artist_plays) values ('g1', 'u1', 'Autechre', 100)`,
    );

    runMigrations(db);

    const indexes = db
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'index' and tbl_name = 'artist_crowns'`,
      )
      .map((r) => r.name);
    expect(indexes).toContain('artist_crowns_guild_artist');
    expect(() =>
      db
        .insert(schema.artistCrowns)
        .values({ guildId: 'g1', userId: 'u2', artistName: 'Autechre', artistPlays: 5 })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it('does not disturb album_crowns rows', () => {
    const db = dbAtMigration0000();
    db.run(
      sql`insert into album_crowns (guild_id, user_id, artist_name, album_name, album_plays)
          values ('g1', 'u1', 'Autechre', 'Confield', 20)`,
    );

    runMigrations(db);

    expect(db.select().from(schema.albumCrowns).all()).toHaveLength(1);
  });
});
