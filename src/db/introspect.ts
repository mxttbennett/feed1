import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { is } from 'drizzle-orm';
import * as schema from './schema.js';

export interface TableInfo {
  name: string;
  columns: string[];
}

const tables: TableInfo[] = Object.values(schema)
  .flatMap((value) => (is(value, SQLiteTable) ? [getTableConfig(value)] : []))
  .map((config) => ({ name: config.name, columns: config.columns.map((c) => c.name) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * The tables `-db` may read, derived from the schema rather than `sqlite_master` so it can never
 * name Drizzle's migration bookkeeping — and so identifiers resolved through it are safe to
 * interpolate into SQL.
 */
export function browsableTables(): TableInfo[] {
  return tables;
}

export function findTable(name: string): TableInfo | undefined {
  return tables.find((t) => t.name === name);
}
