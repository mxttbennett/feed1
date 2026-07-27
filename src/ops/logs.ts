import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const LOGS_DEFAULT = 10;
export const LOGS_MAX = 500;

export const SYSTEMD_UNIT = process.env.SYSTEMD_UNIT ?? 'feed1';

// journald lines are prefixed (timestamp host unit[pid]:), so these match against
// the whole line: error keywords, common network error codes, and V8 stack frames.
const ERROR_KEYWORDS = /error|exception|unhandled|rejection|ETIMEDOUT|ECONN|EADDR|\bthrow\b/i;
const STACK_FRAME = /\bat\s+\S.*\(/;

export function isErrorLine(line: string): boolean {
  return ERROR_KEYWORDS.test(line) || STACK_FRAME.test(line);
}

export interface LogsOptions {
  errorsOnly: boolean;
  count: number;
}

export function parseLogsArgs(args: string[]): LogsOptions {
  const errorsOnly = args.includes('-e') || args.includes('--errors');
  let count = LOGS_DEFAULT;
  const ni = args.findIndex((a) => a === '-n' || a === '--lines');
  if (ni !== -1 && args[ni + 1] !== undefined) {
    const parsed = Number.parseInt(args[ni + 1]!, 10);
    if (Number.isFinite(parsed)) count = parsed;
  }
  count = Math.max(1, Math.min(LOGS_MAX, count));
  return { errorsOnly, count };
}

export type JournalRunner = (unit: string, lines: number) => Promise<string>;

const defaultRunner: JournalRunner = async (unit, lines) => {
  const { stdout } = await execFileAsync('journalctl', [
    '-u',
    unit,
    '--no-pager',
    '-o',
    'short-iso',
    '-n',
    String(lines),
  ]);
  return stdout;
};

/** Fetch the newest `count` log lines (error-filtered when requested). */
export async function readLogs(
  opts: LogsOptions,
  unit: string = SYSTEMD_UNIT,
  run: JournalRunner = defaultRunner,
): Promise<string[]> {
  // when filtering errors we need a wider window to find `count` matches
  const fetch = opts.errorsOnly ? Math.min(Math.max(opts.count * 50, 2000), 10_000) : opts.count;
  const raw = await run(unit, fetch);
  let lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (opts.errorsOnly) lines = lines.filter(isErrorLine);
  return lines.slice(-opts.count);
}
