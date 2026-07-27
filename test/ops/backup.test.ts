import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createBackup } from '../../src/ops/backup.js';
import { createDb, runMigrations, schema } from '../../src/db/index.js';

function tempDbWithUser(): { dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'feed1-backup-'));
  const dbPath = join(dir, 'feed1.sqlite');
  const db = createDb(dbPath);
  runMigrations(db);
  db.insert(schema.users)
    .values({ discordUserId: 'u1', lastfmUsername: 'lfm1', rymUsername: 'has,"comma' })
    .run();
  return { dbPath, dir };
}

describe('createBackup', () => {
  it('snapshots the db and exports users csv', () => {
    const { dbPath, dir } = tempDbWithUser();
    const backupDir = join(dir, 'backups');
    const result = createBackup(dbPath, backupDir);

    const restored = new Database(result.dbFile, { readonly: true });
    const row = restored.prepare('SELECT * FROM users').get() as { lastfm_username: string };
    expect(row.lastfm_username).toBe('lfm1');
    restored.close();

    const csv = readFileSync(result.csvFile, 'utf8');
    expect(csv.split('\n')[0]).toContain('discord_user_id');
    expect(csv).toContain('"has,""comma"');
    expect(result.tableCounts.users).toBe(1);
  });

  it('rotates old backups beyond the retention limit', () => {
    const { dbPath, dir } = tempDbWithUser();
    const backupDir = join(dir, 'backups');
    for (let i = 0; i < 22; i++) createBackup(dbPath, backupDir);
    const files = readdirSync(backupDir).filter((f) => f.endsWith('.sqlite'));
    expect(files.length).toBeLessThanOrEqual(20);
  });
});
