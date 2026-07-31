// CI-only: decides whether deploying a target tag would run code against a
// schema that is ahead of it. Lives outside src/ so it never lands in dist/.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export interface RollbackAssessment {
  safe: boolean;
  reason: string;
}

/**
 * Migration timestamps arrive as untrusted strings from a remote shell, so a
 * malformed reading must throw rather than coerce to NaN — `NaN > target` is
 * false, which would wave an unsafe rollback through.
 */
export function parseMax(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`expected a millisecond integer, got: ${JSON.stringify(raw)}`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`migration timestamp is not a safe integer: ${trimmed}`);
  }
  return value;
}

export function assessRollback({
  appliedMax,
  targetMax,
}: {
  appliedMax: number | null;
  targetMax: number | null;
}): RollbackAssessment {
  if (appliedMax === null) {
    return { safe: true, reason: 'no migrations have been applied to the database yet' };
  }
  if (targetMax === null) {
    return {
      safe: false,
      reason: `the database has migrations applied (up to ${appliedMax}) but the target tag declares none`,
    };
  }
  if (appliedMax > targetMax) {
    return {
      safe: false,
      reason: `the database schema is ahead of the target tag (applied ${appliedMax} > target ${targetMax}) — the target's code has never seen the newer migration(s)`,
    };
  }
  if (appliedMax === targetMax) {
    return { safe: true, reason: `schema is in sync with the target tag (${appliedMax})` };
  }
  return {
    safe: true,
    reason: `the target tag introduces newer migrations (target ${targetMax} > applied ${appliedMax}); they will apply at startup`,
  };
}

/**
 * Exit 2 means "determinately unsafe" and is the only condition the workflow's
 * force flag may override. An unparseable reading throws, exiting 1 — state we
 * couldn't determine is never something to force past.
 */
export const UNSAFE_EXIT = 2;

function main(): void {
  const assessment = assessRollback({
    appliedMax: parseMax(process.env.APPLIED_MAX),
    targetMax: parseMax(process.env.TARGET_MAX),
  });
  process.stdout.write(`${assessment.reason}\n`);
  if (!assessment.safe) process.exitCode = UNSAFE_EXIT;
}

const entry = process.argv[1];
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) main();
