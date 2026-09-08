import { EmbedBuilder } from 'discord.js';
import type { TableInfo } from '../db/introspect.js';

export const ROWS_PER_PAGE = 5;
export const MAX_VALUE_CHARS = 60;

const FIELD_LIMIT = 1024;

export type SortDirection = 'asc' | 'desc';

export interface BrowseState {
  table: TableInfo;
  sortColumn: string;
  direction: SortDirection;
  page: number;
}

/** What better-sqlite3 hands back for a column; blobs arrive as Buffers. */
export type SqlValue = string | number | bigint | Buffer | null;

export type Row = Record<string, SqlValue | undefined>;

const isTimestampColumn = (column: string) =>
  column.endsWith('_at') || column.endsWith('last_used');

export function formatValue(value: SqlValue | undefined, column: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && isTimestampColumn(column)) {
    return new Date(value).toISOString().replace('T', ' ').slice(0, 19);
  }
  if (Buffer.isBuffer(value)) return `${value.length} bytes`;
  const text = String(value);
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text;
}

export function formatRow(row: Row, columns: string[]): string {
  const width = Math.max(...columns.map((c) => c.length));
  const body = columns
    .map((c) => `${c.padEnd(width)}  ${formatValue(row[c], c)}`)
    .join('\n')
    .slice(0, FIELD_LIMIT - 8);
  return `\`\`\`\n${body}\n\`\`\``;
}

export function pageCount(totalRows: number, perPage = ROWS_PER_PAGE): number {
  return Math.max(1, Math.ceil(totalRows / perPage));
}

export function buildBrowseEmbed(state: BrowseState, rows: Row[], totalRows: number): EmbedBuilder {
  const arrow = state.direction === 'asc' ? '▲' : '▼';
  const embed = new EmbedBuilder()
    .setTitle(`Database · ${state.table.name}`)
    .setFooter({ text: `page ${state.page + 1}/${pageCount(totalRows)}` });

  if (rows.length === 0) {
    return embed.setDescription(
      totalRows === 0 ? 'no rows' : `${totalRows} rows · this page is empty`,
    );
  }

  embed.setDescription(
    `${totalRows} row${totalRows === 1 ? '' : 's'} · sorted by \`${state.sortColumn}\` ${arrow}`,
  );
  for (const [i, row] of rows.entries()) {
    embed.addFields({
      name: `#${state.page * ROWS_PER_PAGE + i + 1}`,
      value: formatRow(row, state.table.columns),
    });
  }
  return embed;
}
