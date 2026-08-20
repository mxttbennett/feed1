import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sectionFor } from '../../scripts/changelogSection.js';

describe('changelogSection', () => {
  it('round-trips through sectionFor against the real repo CHANGELOG.md', () => {
    const markdown = readFileSync('CHANGELOG.md', 'utf8');
    const entries = markdown.match(/^## \[(\d+\.\d+\.\d+)\]/gm) ?? [];
    expect(entries.length).toBeGreaterThan(0);
    const firstVersion = /\[(\d+\.\d+\.\d+)\]/.exec(entries[0]!)![1]!;
    const section = sectionFor(markdown, firstVersion);
    expect(section).not.toBeNull();
    expect(section!.length).toBeGreaterThan(0);
  });

  it('returns null for a version with no entry', () => {
    const markdown = readFileSync('CHANGELOG.md', 'utf8');
    expect(sectionFor(markdown, '0.0.1')).toBeNull();
  });
});
