// CI-only: prints the release-notes section for a version. Lives outside src/
// so it never lands in dist/.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sectionFor } from '../src/commands/changelogFormat.js';

export { sectionFor };

function main(): void {
  const version = process.argv[2];
  if (!version) return;
  let markdown: string;
  try {
    markdown = readFileSync('CHANGELOG.md', 'utf8');
  } catch {
    return;
  }
  const section = sectionFor(markdown, version);
  if (section) process.stdout.write(`${section}\n`);
}

const entry = process.argv[1];
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) main();
