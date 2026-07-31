// CI-only: computes the next release version from the latest v* tag and the
// commit that triggered the deploy. Lives outside src/ so it never lands in dist/.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export interface NextVersionInput {
  latestTag: string | null;
  subject: string;
  body: string;
  fallback: string;
}

// `!` must sit before the colon — `fix: fixed it!` is not a breaking change.
const BREAKING_SUBJECT = /^[a-z]+(\([^)]*\))?!:/;
const FEAT_SUBJECT = /^feat(\([^)]*\))?:/;
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function bumpKind(subject: string, body: string): 'major' | 'minor' | 'patch' {
  if (BREAKING_SUBJECT.test(subject) || /BREAKING[ -]CHANGE/.test(body)) return 'major';
  if (FEAT_SUBJECT.test(subject)) return 'minor';
  return 'patch';
}

export function nextVersion({ latestTag, subject, body, fallback }: NextVersionInput): string {
  if (!latestTag) return fallback;

  const parsed = SEMVER.exec(latestTag);
  if (!parsed) throw new Error(`latest tag is not a semver version: ${latestTag}`);
  const [major, minor, patch] = parsed.slice(1, 4).map(Number) as [number, number, number];

  switch (bumpKind(subject, body)) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function main(): void {
  const { LATEST_TAG, SUBJECT, BODY, FALLBACK } = process.env;
  if (!FALLBACK?.trim()) throw new Error('FALLBACK is required');
  process.stdout.write(
    nextVersion({
      latestTag: LATEST_TAG?.trim() ? LATEST_TAG.trim() : null,
      subject: SUBJECT ?? '',
      body: BODY ?? '',
      fallback: FALLBACK.trim(),
    }),
  );
}

const entry = process.argv[1];
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) main();
