import { describe, expect, it } from 'vitest';
import { buildVmEmbed, formatBytes, formatDuration, formatLoad } from '../../src/ops/hostFormat.js';
import type { HostSnapshot } from '../../src/ops/host.js';

const snapshot = (over: Partial<HostSnapshot> = {}): HostSnapshot => ({
  uptimeSeconds: 90_061,
  load: [0.42, 0.38, 0.31],
  cores: 1,
  memory: { total: 6 * 1024 ** 3, available: 4 * 1024 ** 3, source: 'meminfo' },
  disk: { total: 45 * 1024 ** 3, available: 22 * 1024 ** 3 },
  dataSize: 512 * 1024 ** 2,
  process: { uptimeSeconds: 3600, rss: 180 * 1024 ** 2 },
  ...over,
});

const field = (embed: ReturnType<typeof buildVmEmbed>, name: string) =>
  embed.data.fields?.find((f) => f.name === name)?.value;

describe('formatBytes', () => {
  it('scales KB, MB and GB', () => {
    expect(formatBytes(4096)).toBe('4 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB');
  });

  it('switches units at the boundaries', () => {
    expect(formatBytes(1024 ** 2 - 1)).toBe('1024 KB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });
});

describe('formatDuration', () => {
  it('shows the two largest non-zero units', () => {
    expect(formatDuration(90_061)).toBe('1d 1h');
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(formatDuration(61)).toBe('1m 1s');
    expect(formatDuration(45)).toBe('45s');
  });

  it('keeps a zero middle unit rather than skipping to a smaller one', () => {
    expect(formatDuration(86_400 + 61)).toBe('1d 0h');
  });

  it('renders no uptime as 0s', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('formatLoad', () => {
  it('pairs the triple with the core count', () => {
    expect(formatLoad([0.42, 0.38, 0.31], 1)).toBe('0.42  0.38  0.31 · 1 core');
    expect(formatLoad([1, 2, 3], 4)).toBe('1.00  2.00  3.00 · 4 cores');
  });
});

describe('buildVmEmbed', () => {
  it('reports every figure', () => {
    const embed = buildVmEmbed(snapshot());
    expect(embed.data.title).toBe('VM snapshot');
    expect(field(embed, 'uptime')).toBe('1d 1h');
    expect(field(embed, 'load')).toContain('1 core');
    expect(field(embed, 'memory')).toBe('2.0 GB used of 6.0 GB · 4.0 GB available');
    expect(field(embed, 'disk')).toBe('23.0 GB used of 45.0 GB · 22.0 GB free');
    expect(field(embed, '.data')).toBe('512.0 MB');
    expect(field(embed, 'feed1')).toBe('180.0 MB RSS · up 1h 0m');
  });

  it('marks memory read through the os fallback', () => {
    const embed = buildVmEmbed(
      snapshot({ memory: { total: 6 * 1024 ** 3, available: 200 * 1024 ** 2, source: 'os' } }),
    );
    expect(field(embed, 'memory')).toContain('via os.freemem');
  });

  it('says unavailable rather than zero when a source could not be read', () => {
    const embed = buildVmEmbed(snapshot({ disk: undefined, dataSize: undefined }));
    expect(field(embed, 'disk')).toBe('unavailable');
    expect(field(embed, '.data')).toBe('unavailable');
    expect(field(embed, 'uptime')).toBe('1d 1h');
  });

  it('says the figures cover the whole box', () => {
    expect(buildVmEmbed(snapshot()).data.footer?.text).toContain('whole VM');
  });
});
