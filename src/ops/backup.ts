import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEEP_BACKUPS = 20;
export const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

let backupSeq = 0;

export interface BackupResult {
  dbFile: string;
  csvFile: string;
  deleted: number;
  tableCounts: Record<string, number>;
}

/**
 * Snapshot the SQLite DB (VACUUM INTO — safe against concurrent writers) plus a
 * users CSV, keeping the newest KEEP_BACKUPS database snapshots.
 */
export function createBackup(dbPath: string, backupDir: string): BackupResult {
  mkdirSync(join(backupDir, 'users'), { recursive: true });
  // sequence suffix keeps same-millisecond backups (tests, manual runs) from colliding
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}_${backupSeq++}`;

  const db = new Database(dbPath, { readonly: false });
  try {
    const dbFile = join(backupDir, `feed1_${stamp}.sqlite`);
    db.prepare(`VACUUM INTO ?`).run(dbFile);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    const tableCounts: Record<string, number> = {};
    for (const { name } of tables) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
      tableCounts[name] = row.n;
    }

    const users = db.prepare(`SELECT * FROM users`).all() as Record<string, unknown>[];
    const csvFile = join(backupDir, 'users', `users_${stamp}.csv`);
    if (users.length > 0) {
      const headers = Object.keys(users[0]!);
      // sqlite rows only hold primitives, so String() is safe here
      const escape = (v: unknown) =>
        `"${String((v as string | number | null) ?? '').replaceAll('"', '""')}"`;
      const csv = [
        headers.join(','),
        ...users.map((u) => headers.map((h) => escape(u[h])).join(',')),
      ].join('\n');
      writeFileSync(csvFile, csv);
    } else {
      writeFileSync(csvFile, '');
    }

    const old = readdirSync(backupDir)
      .filter((f) => f.startsWith('feed1_') && f.endsWith('.sqlite'))
      .map((f) => ({ f, mtime: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(KEEP_BACKUPS);
    for (const { f } of old) unlinkSync(join(backupDir, f));

    return { dbFile, csvFile, deleted: old.length, tableCounts };
  } finally {
    db.close();
  }
}

export function formatBackupReport(result: BackupResult): string {
  const counts = Object.entries(result.tableCounts)
    .map(([table, n]) => `${table}: ${n}`)
    .join(' | ');
  return `backup complete → ${result.dbFile}\n${counts}`;
}
