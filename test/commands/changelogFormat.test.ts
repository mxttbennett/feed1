import { describe, expect, it } from 'vitest';
import { changelogPages, parseChangelog, sectionFor } from '../../src/commands/changelogFormat.js';

describe('parseChangelog', () => {
  it('parses a well-formed heading with bracket and date', () => {
    const md = '## [1.2.3] - 2026-01-01\n\n- did a thing\n- did another thing\n';
    const entries = parseChangelog(md);
    expect(entries).toEqual([
      { version: '1.2.3', date: '2026-01-01', lines: ['- did a thing', '- did another thing'] },
    ]);
  });

  it('parses a bracketless heading', () => {
    const md = '## 1.2.3 - 2026-01-01\n\n- did a thing\n';
    expect(parseChangelog(md)).toEqual([
      { version: '1.2.3', date: '2026-01-01', lines: ['- did a thing'] },
    ]);
  });

  it('accepts an em-dash before the date', () => {
    const md = '## [1.2.3] — 2026-01-01\n\n- did a thing\n';
    expect(parseChangelog(md)[0]?.date).toBe('2026-01-01');
  });

  it('tolerates a missing date', () => {
    const md = '## [1.2.3]\n\n- did a thing\n';
    expect(parseChangelog(md)).toEqual([{ version: '1.2.3', date: null, lines: ['- did a thing'] }]);
  });

  it('ignores preamble before the first heading', () => {
    const md = '# Changelog\n\nSome preamble text.\n\n## [1.0.0] - 2026-01-01\n\n- thing\n';
    const entries = parseChangelog(md);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.0');
  });

  it('ignores a non-version heading', () => {
    const md = '## Changelog\n\n- ignored\n\n## [1.0.0] - 2026-01-01\n\n- thing\n';
    const entries = parseChangelog(md);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.0');
  });

  it('returns an empty array for an empty file', () => {
    expect(parseChangelog('')).toEqual([]);
  });
});

describe('changelogPages', () => {
  it('packs multiple entries onto one page under budget', () => {
    const entries = parseChangelog(
      '## [1.0.1] - 2026-01-02\n\n- fix\n\n## [1.0.0] - 2026-01-01\n\n- initial\n',
    );
    const pages = changelogPages(entries, 1800);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('v1.0.1');
    expect(pages[0]).toContain('v1.0.0');
  });

  it('starts a new page when the next whole entry would exceed the budget', () => {
    const entries = parseChangelog(
      '## [1.0.1] - 2026-01-02\n\n- fix\n\n## [1.0.0] - 2026-01-01\n\n- initial\n',
    );
    const pages = changelogPages(entries, 30);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('v1.0.1');
    expect(pages[1]).toContain('v1.0.0');
  });

  it('splits an over-budget single entry at line boundaries, repeating the heading', () => {
    const md =
      '## [1.0.0] - 2026-01-01\n\n' +
      Array.from({ length: 10 }, (_, i) => `- line number ${i} is reasonably long text`).join(
        '\n',
      ) +
      '\n';
    const entries = parseChangelog(md);
    const pages = changelogPages(entries, 80);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page).toContain('v1.0.0');
      expect(page.length).toBeLessThanOrEqual(80 + 60); // heading repeat plus one line's slack
    }
  });
});

describe('sectionFor', () => {
  const md = '## [1.0.1] - 2026-01-02\n\n- fix\n\n## [1.0.0] - 2026-01-01\n\n- initial\n';

  it('returns the bullet block for a known version', () => {
    expect(sectionFor(md, '1.0.0')).toBe('- initial');
  });

  it('returns null for a version not present', () => {
    expect(sectionFor(md, '9.9.9')).toBeNull();
  });
});
