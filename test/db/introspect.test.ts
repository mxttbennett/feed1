import { describe, expect, it } from 'vitest';
import { browsableTables, findTable } from '../../src/db/introspect.js';

describe('browsableTables', () => {
  it('lists the schema tables in name order', () => {
    const names = browsableTables().map((t) => t.name);
    expect(names).toContain('users');
    expect(names).toContain('banner_images');
    expect(names).toEqual([...names].sort());
  });

  it('reports the real column names for users', () => {
    expect(findTable('users')?.columns).toEqual([
      'id',
      'discord_user_id',
      'lastfm_username',
      'rym_username',
      'rym_per_page',
      'rym_max',
      'wish_max',
      'tag_max',
      'tag',
      'chart_url',
      'created_at',
      'last_used',
      'command_count',
    ]);
  });

  it('does not expose drizzle bookkeeping or unknown names', () => {
    expect(findTable('__drizzle_migrations')).toBeUndefined();
    expect(findTable('sqlite_master')).toBeUndefined();
    expect(findTable('users; DROP TABLE users')).toBeUndefined();
  });

  it('stays inside Discord select-menu limits', () => {
    const tables = browsableTables();
    expect(tables.length).toBeLessThanOrEqual(25);
    for (const table of tables) {
      expect(table.columns.length).toBeLessThanOrEqual(25);
    }
  });
});
