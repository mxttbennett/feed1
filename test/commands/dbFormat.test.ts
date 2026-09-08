import { describe, expect, it } from 'vitest';
import {
  buildBrowseEmbed,
  formatRow,
  formatValue,
  MAX_VALUE_CHARS,
  pageCount,
  ROWS_PER_PAGE,
  type BrowseState,
} from '../../src/commands/dbFormat.js';
import { browsableTables, findTable } from '../../src/db/introspect.js';

const users = findTable('users')!;

describe('formatValue', () => {
  it('renders missing values as NULL', () => {
    expect(formatValue(null, 'tag')).toBe('NULL');
    expect(formatValue(undefined, 'tag')).toBe('NULL');
  });

  it('renders timestamp columns as readable dates', () => {
    expect(formatValue(Date.UTC(2026, 0, 2, 3, 4, 5), 'created_at')).toBe('2026-01-02 03:04:05');
    expect(formatValue(Date.UTC(2026, 0, 2, 3, 4, 5), 'last_used')).toBe('2026-01-02 03:04:05');
  });

  it('leaves numbers in non-timestamp columns alone', () => {
    expect(formatValue(1767326645000, 'command_count')).toBe('1767326645000');
  });

  it('truncates long values', () => {
    const long = 'x'.repeat(200);
    const out = formatValue(long, 'chart_url');
    expect(out).toHaveLength(MAX_VALUE_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('pageCount', () => {
  it('gives an empty table one page', () => {
    expect(pageCount(0)).toBe(1);
  });

  it('rounds partial pages up', () => {
    expect(pageCount(ROWS_PER_PAGE)).toBe(1);
    expect(pageCount(ROWS_PER_PAGE + 1)).toBe(2);
  });
});

describe('buildBrowseEmbed', () => {
  const state = (over: Partial<BrowseState> = {}): BrowseState => ({
    table: users,
    sortColumn: 'id',
    direction: 'asc',
    page: 0,
    ...over,
  });

  it('says so when the table is empty', () => {
    const embed = buildBrowseEmbed(state(), [], 0);
    expect(embed.data.description).toBe('no rows');
    expect(embed.data.fields).toBeUndefined();
    expect(embed.data.footer?.text).toBe('page 1/1');
  });

  it('numbers rows continuing across pages', () => {
    const rows = [{ id: 6 }, { id: 7 }];
    const embed = buildBrowseEmbed(state({ page: 1 }), rows, 12);
    expect(embed.data.fields?.map((f) => f.name)).toEqual(['#6', '#7']);
    expect(embed.data.footer?.text).toBe('page 2/3');
  });

  it('shows the sort column and direction', () => {
    const asc = buildBrowseEmbed(state(), [{ id: 1 }], 1);
    expect(asc.data.description).toBe('1 row · sorted by `id` ▲');

    const desc = buildBrowseEmbed(
      state({ sortColumn: 'command_count', direction: 'desc' }),
      [{ id: 1 }],
      2,
    );
    expect(desc.data.description).toBe('2 rows · sorted by `command_count` ▼');
  });

  it('stays inside Discord embed limits with worst-case rows on the widest table', () => {
    const widest = browsableTables().reduce((a, b) =>
      a.columns.length >= b.columns.length ? a : b,
    );
    const row = Object.fromEntries(widest.columns.map((c) => [c, 'y'.repeat(500)]));
    const rows = Array.from({ length: ROWS_PER_PAGE }, () => row);
    const embed = buildBrowseEmbed(
      state({ table: widest, sortColumn: widest.columns[0]! }),
      rows,
      99,
    );

    const fields = embed.data.fields ?? [];
    expect(fields).toHaveLength(ROWS_PER_PAGE);
    for (const field of fields) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
    expect(JSON.stringify(embed.data).length).toBeLessThan(6000);
  });

  it('keeps a formatted row inside the field limit', () => {
    const row = Object.fromEntries(users.columns.map((c) => [c, 'z'.repeat(500)]));
    expect(formatRow(row, users.columns).length).toBeLessThanOrEqual(1024);
  });
});
