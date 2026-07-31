import { describe, expect, it } from 'vitest';
import { bumpKind, nextVersion } from '../../scripts/nextVersion.js';

const base = { latestTag: 'v2.0.0', body: '', fallback: '2.0.0' };

describe('bumpKind', () => {
  it('treats a bang before the colon as breaking', () => {
    expect(bumpKind('feat(db)!: drop the crowns table', '')).toBe('major');
    expect(bumpKind('fix!: change the reply shape', '')).toBe('major');
  });

  it('does not treat a bang elsewhere in the subject as breaking', () => {
    expect(bumpKind('fix: fixed it!', '')).toBe('patch');
    expect(bumpKind('feat: now with charts!', '')).toBe('minor');
  });

  it('honors BREAKING CHANGE in the body regardless of subject', () => {
    expect(bumpKind('chore: tidy up', 'BREAKING CHANGE: env var renamed')).toBe('major');
    expect(bumpKind('chore: tidy up', 'BREAKING-CHANGE: env var renamed')).toBe('major');
  });

  it('maps feat to minor and everything else to patch', () => {
    expect(bumpKind('feat(fm): show artist ranks (#13)', '')).toBe('minor');
    expect(bumpKind('fix(fm): shorten the note (#14)', '')).toBe('patch');
    expect(bumpKind('chore: rename to feed1 (#12)', '')).toBe('patch');
    expect(bumpKind('docs(deploy): record the VM shape', '')).toBe('patch');
  });

  it('falls back to patch for non-conventional subjects', () => {
    expect(bumpKind('wip', '')).toBe('patch');
    expect(bumpKind('Merge pull request #5 from mxttbennett/beta-branch', '')).toBe('patch');
    expect(bumpKind('', '')).toBe('patch');
  });
});

describe('nextVersion', () => {
  it('returns the fallback verbatim when no tag exists yet', () => {
    expect(nextVersion({ ...base, latestTag: null, subject: 'feat: anything' })).toBe('2.0.0');
  });

  it('bumps patch, minor, and major off the latest tag', () => {
    expect(nextVersion({ ...base, subject: 'fix(fm): shorten the note (#14)' })).toBe('2.0.1');
    expect(nextVersion({ ...base, subject: 'feat(fm): show artist ranks (#13)' })).toBe('2.1.0');
    expect(nextVersion({ ...base, subject: 'feat(db)!: drop a table' })).toBe('3.0.0');
  });

  it('resets lower components on minor and major bumps', () => {
    expect(nextVersion({ ...base, latestTag: 'v2.4.7', subject: 'feat: x' })).toBe('2.5.0');
    expect(nextVersion({ ...base, latestTag: 'v2.4.7', subject: 'feat!: x' })).toBe('3.0.0');
  });

  it('handles multi-digit components without string sorting artifacts', () => {
    expect(nextVersion({ ...base, latestTag: 'v2.9.0', subject: 'feat: x' })).toBe('2.10.0');
    expect(nextVersion({ ...base, latestTag: 'v2.0.9', subject: 'fix: x' })).toBe('2.0.10');
    expect(nextVersion({ ...base, latestTag: 'v10.0.0', subject: 'fix: x' })).toBe('10.0.1');
  });

  it('tolerates a missing v prefix', () => {
    expect(nextVersion({ ...base, latestTag: '2.0.0', subject: 'fix: x' })).toBe('2.0.1');
  });

  it('rejects a non-semver tag rather than guessing', () => {
    expect(() => nextVersion({ ...base, latestTag: 'legacy', subject: 'fix: x' })).toThrow(/not a semver/);
    expect(() => nextVersion({ ...base, latestTag: 'v2.0', subject: 'fix: x' })).toThrow(/not a semver/);
  });
});
