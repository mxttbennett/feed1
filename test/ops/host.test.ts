import { describe, expect, it } from 'vitest';
import { parseMeminfo, readHostSnapshot, type HostDeps } from '../../src/ops/host.js';

const MEMINFO = [
  'MemTotal:        5952512 kB',
  'MemFree:          198432 kB',
  'MemAvailable:    4210304 kB',
  'Buffers:          102400 kB',
  'SwapTotal:             0 kB',
].join('\n');

const deps = (over: Partial<HostDeps> = {}): HostDeps => ({
  readMeminfo: () => MEMINFO,
  statfs: () => ({ bsize: 4096, blocks: 1000, bavail: 250 }),
  dirSize: () => 12345,
  os: {
    uptime: () => 90_061,
    loadavg: () => [0.42, 0.38, 0.31],
    cpus: () => [{}],
    totalmem: () => 6_096_912_384,
    freemem: () => 203_194_368,
  },
  ...over,
});

describe('parseMeminfo', () => {
  it('reads MemTotal and MemAvailable as bytes', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      total: 5952512 * 1024,
      available: 4210304 * 1024,
    });
  });

  it('returns undefined when MemAvailable is absent', () => {
    expect(parseMeminfo('MemTotal:  5952512 kB\nMemFree:  198432 kB')).toBeUndefined();
  });

  it('returns undefined for an unrecognised shape', () => {
    expect(parseMeminfo('nothing useful here')).toBeUndefined();
  });

  it('does not confuse MemTotal with a longer key that contains it', () => {
    expect(parseMeminfo('ShmemTotal:  100 kB\nMemAvailable:  200 kB')).toBeUndefined();
  });
});

describe('readHostSnapshot', () => {
  it('prefers /proc/meminfo', () => {
    const snapshot = readHostSnapshot('.data', deps());
    expect(snapshot.memory).toEqual({
      total: 5952512 * 1024,
      available: 4210304 * 1024,
      source: 'meminfo',
    });
  });

  it('falls back to os when /proc/meminfo cannot be read', () => {
    const snapshot = readHostSnapshot(
      '.data',
      deps({
        readMeminfo: () => {
          throw new Error('ENOENT');
        },
      }),
    );
    expect(snapshot.memory).toEqual({
      total: 6_096_912_384,
      available: 203_194_368,
      source: 'os',
    });
  });

  it('falls back to os when meminfo parses to nothing', () => {
    const snapshot = readHostSnapshot('.data', deps({ readMeminfo: () => 'garbage' }));
    expect(snapshot.memory.source).toBe('os');
  });

  it('turns statfs blocks into bytes', () => {
    const snapshot = readHostSnapshot('.data', deps());
    expect(snapshot.disk).toEqual({ total: 4096 * 1000, available: 4096 * 250 });
  });

  it('reports host and process figures', () => {
    const snapshot = readHostSnapshot('.data', deps());
    expect(snapshot.uptimeSeconds).toBe(90_061);
    expect(snapshot.load).toEqual([0.42, 0.38, 0.31]);
    expect(snapshot.cores).toBe(1);
    expect(snapshot.dataSize).toBe(12345);
    expect(snapshot.process.rss).toBeGreaterThan(0);
    expect(snapshot.process.uptimeSeconds).toBeGreaterThan(0);
  });

  it('survives an unreadable disk without losing the rest', () => {
    const snapshot = readHostSnapshot(
      '.data',
      deps({
        statfs: () => {
          throw new Error('ENOENT');
        },
      }),
    );
    expect(snapshot.disk).toBeUndefined();
    expect(snapshot.dataSize).toBe(12345);
    expect(snapshot.memory.source).toBe('meminfo');
  });

  it('survives an unwalkable data directory without losing the rest', () => {
    const snapshot = readHostSnapshot(
      '.data',
      deps({
        dirSize: () => {
          throw new Error('EACCES');
        },
      }),
    );
    expect(snapshot.dataSize).toBeUndefined();
    expect(snapshot.disk).toEqual({ total: 4096 * 1000, available: 4096 * 250 });
  });

  it('passes the data directory to both filesystem reads', () => {
    const seen: string[] = [];
    readHostSnapshot(
      '/opt/feed1/.data',
      deps({
        statfs: (path) => {
          seen.push(path);
          return { bsize: 1, blocks: 1, bavail: 1 };
        },
        dirSize: (path) => {
          seen.push(path);
          return 0;
        },
      }),
    );
    expect(seen).toEqual(['/opt/feed1/.data', '/opt/feed1/.data']);
  });
});
