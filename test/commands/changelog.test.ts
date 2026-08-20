import { describe, expect, it, vi } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { changelogCommands, readChangelogFile } from '../../src/commands/changelog.js';
import { parseChangelog } from '../../src/commands/changelogFormat.js';
import { readPackageVersion } from '../../src/core/version.js';
import { makeFakeMessage } from '../helpers/fake.js';

// Controls whether the mocked `readFileSync` below throws, so the command's
// read-failure branch is reachable through its real (path-less) call site.
let failReads = false;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (failReads) throw new Error('enoent');
      return actual.readFileSync(...args);
    },
  };
});

const changelog = changelogCommands.find((c) => c.name === 'changelog')!;

describe('read failures', () => {
  it('readChangelogFile returns null for a nonexistent path', () => {
    expect(readChangelogFile('/nonexistent/CHANGELOG.md')).toBeNull();
  });

  it('&changelog replies with a not-found message when the file cannot be read', async () => {
    failReads = true;
    try {
      const fake = makeFakeMessage({ content: '&changelog' });
      await changelog.run({ app: undefined as never, message: fake.message, args: [] });
      expect(fake.replies[0]).toBe(`couldn't read the changelog.`);
    } finally {
      failReads = false;
    }
  });
});

describe('&changelog', () => {
  it('pages the real repo CHANGELOG.md, with the newest entry matching the running version', async () => {
    const fake = makeFakeMessage({ content: '&changelog' });
    await changelog.run({ app: undefined as never, message: fake.message, args: [] });

    expect(fake.embeds.length).toBeGreaterThan(0);
    const first = fake.embeds[0] as EmbedBuilder;
    expect(first.data.description).toContain(readPackageVersion());
    expect(first.data.footer?.text).toMatch(/^page no\. 1\//);

    expect(fake.payloads.length).toBeGreaterThan(0);
    await fake.click('next');
    const second = fake.embeds.find((e) =>
      (e as EmbedBuilder).data.footer?.text?.startsWith('page no. 2/'),
    );
    expect(second).toBeDefined();
  });

  it('parses the newest entry to match package.json version (catches a forgotten bump entry)', () => {
    const markdown = readChangelogFile();
    expect(markdown).not.toBeNull();
    const entries = parseChangelog(markdown!);
    expect(entries[0]?.version).toBe(readPackageVersion());
  });
});
