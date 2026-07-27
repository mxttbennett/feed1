import { describe, expect, it } from 'vitest';
import {
  LOGS_DEFAULT,
  LOGS_MAX,
  isErrorLine,
  parseLogsArgs,
  readLogs,
  type JournalRunner,
} from '../../src/ops/logs.js';

describe('parseLogsArgs', () => {
  it('defaults to 10 lines, all logs', () => {
    expect(parseLogsArgs([])).toEqual({ errorsOnly: false, count: LOGS_DEFAULT });
  });

  it('reads -e as errors-only', () => {
    expect(parseLogsArgs(['-e'])).toEqual({ errorsOnly: true, count: LOGS_DEFAULT });
  });

  it('reads -n <count>', () => {
    expect(parseLogsArgs(['-n', '100'])).toEqual({ errorsOnly: false, count: 100 });
  });

  it('combines -e and -n in any order', () => {
    expect(parseLogsArgs(['-e', '-n', '200'])).toEqual({ errorsOnly: true, count: 200 });
    expect(parseLogsArgs(['-n', '200', '-e'])).toEqual({ errorsOnly: true, count: 200 });
  });

  it('clamps count to [1, LOGS_MAX] and ignores garbage', () => {
    expect(parseLogsArgs(['-n', '99999']).count).toBe(LOGS_MAX);
    expect(parseLogsArgs(['-n', '0']).count).toBe(1);
    expect(parseLogsArgs(['-n', 'abc']).count).toBe(LOGS_DEFAULT);
    expect(parseLogsArgs(['-n']).count).toBe(LOGS_DEFAULT);
  });
});

describe('isErrorLine', () => {
  const stamp = '2026-07-27T20:36:57+0000 host feed1[8236]:';
  it('matches error messages and stack frames', () => {
    expect(isErrorLine(`${stamp} [command wk] GatewayRateLimitError: rate limited`)).toBe(true);
    expect(isErrorLine(`${stamp}     at Client.rateLimitHandler (/opt/feed1/x.js:287:18)`)).toBe(
      true,
    );
    expect(isErrorLine(`${stamp} [scan] Last.fm error 8 on artist.getinfo: ECONNRESET`)).toBe(true);
  });
  it('ignores ordinary info lines', () => {
    expect(isErrorLine(`${stamp} feed1 logged in as feed1#3067`)).toBe(false);
    expect(isErrorLine(`${stamp} backup complete → .data/backups/feed1_x.sqlite`)).toBe(false);
    expect(isErrorLine(`${stamp} users: 53 | crowns: 2`)).toBe(false);
  });
});

const SAMPLE = [
  'T1 host feed1[1]: feed1 logged in as feed1#3067',
  'T2 host feed1[1]: backup complete → x.sqlite',
  'T3 host feed1[1]: [command wk] GatewayRateLimitError: rate limited',
  'T4 host feed1[1]:     at Client.rateLimitHandler (/opt/feed1/x.js:287:18)',
  'T5 host feed1[1]: users: 53',
  'T6 host feed1[1]: [scan] Last.fm error 8 on artist.getinfo: timeout',
].join('\n');

describe('readLogs', () => {
  const runner = (out: string): JournalRunner => () => Promise.resolve(out);

  it('returns the newest N lines unfiltered', async () => {
    const lines = await readLogs({ errorsOnly: false, count: 2 }, 'feed1', runner(SAMPLE));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Last.fm error 8');
  });

  it('filters to only error lines when errorsOnly', async () => {
    const lines = await readLogs({ errorsOnly: true, count: 10 }, 'feed1', runner(SAMPLE));
    expect(lines).toHaveLength(3);
    expect(lines.every(isErrorLine)).toBe(true);
    expect(lines.some((l) => l.includes('logged in'))).toBe(false);
  });

  it('takes the newest N of the filtered errors', async () => {
    const lines = await readLogs({ errorsOnly: true, count: 1 }, 'feed1', runner(SAMPLE));
    expect(lines).toEqual(['T6 host feed1[1]: [scan] Last.fm error 8 on artist.getinfo: timeout']);
  });

  it('drops blank lines', async () => {
    const lines = await readLogs({ errorsOnly: false, count: 10 }, 'feed1', runner('a\n\n\nb\n'));
    expect(lines).toEqual(['a', 'b']);
  });

  it('requests a wider window when filtering errors', async () => {
    let requested = 0;
    const spy: JournalRunner = (_u, n) => {
      requested = n;
      return Promise.resolve(SAMPLE);
    };
    await readLogs({ errorsOnly: true, count: 5 }, 'feed1', spy);
    expect(requested).toBeGreaterThanOrEqual(2000);
    await readLogs({ errorsOnly: false, count: 5 }, 'feed1', spy);
    expect(requested).toBe(5);
  });
});
