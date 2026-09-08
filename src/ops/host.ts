import { readFileSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export interface MemoryStat {
  total: number;
  available: number;
  /** `os.freemem()` excludes the page cache, so a fallback reading means something different */
  source: 'meminfo' | 'os';
}

export interface DiskStat {
  total: number;
  available: number;
}

export interface HostSnapshot {
  uptimeSeconds: number;
  load: number[];
  cores: number;
  memory: MemoryStat;
  disk: DiskStat | undefined;
  dataSize: number | undefined;
  process: { uptimeSeconds: number; rss: number };
}

export interface HostDeps {
  readMeminfo(): string;
  statfs(path: string): { bsize: number; blocks: number; bavail: number };
  dirSize(path: string): number;
  os: {
    uptime(): number;
    loadavg(): number[];
    cpus(): unknown[];
    totalmem(): number;
    freemem(): number;
  };
}

function walk(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += walk(child);
    else if (entry.isFile()) total += statSync(child).size;
  }
  return total;
}

export const defaultHostDeps: HostDeps = {
  readMeminfo: () => readFileSync('/proc/meminfo', 'utf8'),
  statfs: (path) => statfsSync(path),
  dirSize: walk,
  os,
};

/** Bytes of MemTotal/MemAvailable, or undefined if the file doesn't carry both. */
export function parseMeminfo(text: string): { total: number; available: number } | undefined {
  const read = (key: string): number | undefined => {
    const match = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(text);
    return match ? Number(match[1]) * 1024 : undefined;
  };
  const total = read('MemTotal');
  const available = read('MemAvailable');
  if (total === undefined || available === undefined) return undefined;
  return { total, available };
}

function readMemory(deps: HostDeps): MemoryStat {
  try {
    const parsed = parseMeminfo(deps.readMeminfo());
    if (parsed) return { ...parsed, source: 'meminfo' };
  } catch {
    // no /proc on macOS; os.freemem() is the honest best-effort there
  }
  return { total: deps.os.totalmem(), available: deps.os.freemem(), source: 'os' };
}

export function readHostSnapshot(dataDir: string, deps: HostDeps = defaultHostDeps): HostSnapshot {
  let disk: DiskStat | undefined;
  try {
    const fs = deps.statfs(dataDir);
    disk = { total: fs.bsize * fs.blocks, available: fs.bsize * fs.bavail };
  } catch {
    disk = undefined;
  }

  let dataSize: number | undefined;
  try {
    dataSize = deps.dirSize(dataDir);
  } catch {
    dataSize = undefined;
  }

  return {
    uptimeSeconds: deps.os.uptime(),
    load: deps.os.loadavg(),
    cores: deps.os.cpus().length,
    memory: readMemory(deps),
    disk,
    dataSize,
    process: { uptimeSeconds: process.uptime(), rss: process.memoryUsage().rss },
  };
}
