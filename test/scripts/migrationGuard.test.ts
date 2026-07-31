import { describe, expect, it } from 'vitest';
import { assessRollback, parseMax } from '../../scripts/migrationGuard.js';

// the `when` of drizzle/meta/_journal.json's only entry today
const APPLIED_TODAY = 1784230224030;

describe('parseMax', () => {
  it('treats absent and empty readings as "nothing applied"', () => {
    expect(parseMax(undefined)).toBeNull();
    expect(parseMax('')).toBeNull();
    expect(parseMax('   ')).toBeNull();
  });

  it('accepts a millisecond integer, ignoring surrounding whitespace', () => {
    expect(parseMax('1784230224030')).toBe(APPLIED_TODAY);
    expect(parseMax(' 1784230224030\n')).toBe(APPLIED_TODAY);
    expect(parseMax('0')).toBe(0);
  });

  it('throws rather than coercing malformed readings to NaN', () => {
    // NaN > target is false, so coercion here would silently allow an unsafe rollback
    for (const bad of ['abc', 'NaN', '12.5', '-1', '1e21', '1784230224030 error', 'null']) {
      expect(() => parseMax(bad), bad).toThrow();
    }
  });

  it('rejects values beyond safe integer precision', () => {
    expect(() => parseMax('9007199254740993')).toThrow(/safe integer/);
  });
});

describe('assessRollback', () => {
  it('is safe when nothing has been applied yet', () => {
    expect(assessRollback({ appliedMax: null, targetMax: APPLIED_TODAY }).safe).toBe(true);
    expect(assessRollback({ appliedMax: null, targetMax: null }).safe).toBe(true);
  });

  it('refuses when the database is ahead of the target tag', () => {
    const result = assessRollback({ appliedMax: 1799999999999, targetMax: APPLIED_TODAY });
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('ahead of the target tag');
    expect(result.reason).toContain('1799999999999');
    expect(result.reason).toContain(String(APPLIED_TODAY));
  });

  it('refuses when the target tag declares no migrations at all', () => {
    const result = assessRollback({ appliedMax: APPLIED_TODAY, targetMax: null });
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('declares none');
  });

  it('is safe when schema and target are in sync', () => {
    const result = assessRollback({ appliedMax: APPLIED_TODAY, targetMax: APPLIED_TODAY });
    expect(result.safe).toBe(true);
    expect(result.reason).toContain('in sync');
  });

  it('is safe when the target introduces newer migrations (a forward deploy)', () => {
    const result = assessRollback({ appliedMax: APPLIED_TODAY, targetMax: 1799999999999 });
    expect(result.safe).toBe(true);
    expect(result.reason).toContain('will apply at startup');
  });

  it('treats a one-millisecond lead as unsafe — the boundary drizzle itself uses', () => {
    expect(assessRollback({ appliedMax: APPLIED_TODAY + 1, targetMax: APPLIED_TODAY }).safe).toBe(false);
    expect(assessRollback({ appliedMax: APPLIED_TODAY - 1, targetMax: APPLIED_TODAY }).safe).toBe(true);
  });

  it('keeps precision near the safe-integer ceiling', () => {
    const hi = Number.MAX_SAFE_INTEGER;
    expect(assessRollback({ appliedMax: hi, targetMax: hi - 1 }).safe).toBe(false);
    expect(assessRollback({ appliedMax: hi - 1, targetMax: hi }).safe).toBe(true);
  });
});
