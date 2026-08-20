export interface ChangelogEntry {
  version: string;
  date: string | null;
  lines: string[];
}

const HEADING = /^##\s*\[?(\d+\.\d+\.\d+)\]?\s*[-–—]?\s*(\S+)?/;

/** Scans `## [x.y.z] - date` headings; preserves file order (authored newest-first). */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;

  for (const raw of markdown.split('\n')) {
    if (raw.startsWith('## ') || raw.startsWith('##\t')) {
      const match = HEADING.exec(raw);
      if (match) {
        current = { version: match[1]!, date: match[2] ?? null, lines: [] };
        entries.push(current);
        continue;
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const line = raw.trim();
    if (line.length === 0) continue;
    if (!line.startsWith('-') && current.lines.length > 0) {
      current.lines[current.lines.length - 1] += ` ${line}`;
    } else {
      current.lines.push(line);
    }
  }

  return entries;
}

function entryHeader(entry: ChangelogEntry): string {
  return entry.date ? `**v${entry.version}** — ${entry.date}` : `**v${entry.version}**`;
}

function renderEntry(entry: ChangelogEntry): string {
  return [entryHeader(entry), ...entry.lines].join('\n');
}

/** Greedy-packs whole entries into pages; an over-budget entry splits at line boundaries. */
export function changelogPages(entries: ChangelogEntry[], budget = 1800): string[] {
  const pages: string[] = [];
  let current = '';

  const flush = () => {
    if (current.length > 0) {
      pages.push(current);
      current = '';
    }
  };

  for (const entry of entries) {
    const rendered = renderEntry(entry);
    if (rendered.length > budget) {
      flush();
      const header = entryHeader(entry);
      let chunk = header;
      for (const line of entry.lines) {
        const candidate = `${chunk}\n${line}`;
        if (candidate.length > budget && chunk !== header) {
          pages.push(chunk);
          chunk = `${header}\n${line}`;
        } else {
          chunk = candidate;
        }
      }
      if (chunk.length > 0) pages.push(chunk);
      continue;
    }

    const candidate = current.length === 0 ? rendered : `${current}\n\n${rendered}`;
    if (candidate.length > budget && current.length > 0) {
      flush();
      current = rendered;
    } else {
      current = candidate;
    }
  }
  flush();

  return pages;
}

/** The bullet block for one version, for release notes. */
export function sectionFor(markdown: string, version: string): string | null {
  const entry = parseChangelog(markdown).find((e) => e.version === version);
  if (!entry) return null;
  return entry.lines.join('\n');
}
