# feed1

Last.fm Discord bot. TypeScript (strict, ESM), discord.js v14 prefix commands, better-sqlite3 +
Drizzle, vitest. A 2.0 rewrite of a JavaScript bot preserved at the `legacy` tag.

## Layout

| Path | What lives there |
|---|---|
| `src/commands/` | one file per command, each exporting a `Command` (`name`, `aliases`, `run`) |
| `src/core/` | router, command registry, config (zod-validated env), db handle, error reporter, mutex |
| `src/lastfm/` | API client + raw response types; **all** Last.fm calls go through `LastfmClient` |
| `src/db/` | Drizzle schema; migrations in `drizzle/` are applied at startup |
| `src/crowns/` | crown service + background job worker |
| `src/banner/` | image validation, on-disk image store, banner rotation service + scheduler |
| `src/charts/`, `src/ops/` | node-canvas chart rendering; backup and log-reading helpers |

Pure formatting logic is split into a sibling module (`fm.ts` → `fmFormat.ts`) so it can be unit
tested without Discord or HTTP.

## Conventions

- **Legacy output fidelity is a feature.** Footer text, `&ast` asterisk escaping, singular/plural
  rank labels and similar quirks are deliberately byte-compatible with the old bot. Don't "fix"
  odd-looking strings — they're reproduced on purpose, and tests assert them exactly.
- **One shared rate limiter** gates every Last.fm request process-wide (`src/lastfm/rateLimiter.ts`,
  250 ms between request starts). Commands that page through large result sets are the heavy
  neighbours; keep page budgets deliberate.
- Long-running enrichment edits a sent embed in place rather than blocking on a complete result.
  Edits that only *add* optional detail should swallow their failures so a hiccup can't discard an
  already-good message.
- Numbers arrive from Last.fm as strings — parse with `toInt()` from `src/lastfm/types.ts`.
- **Banner images are stored as bytes, never as URLs.** Discord CDN attachment links carry expiring
  signatures, so a stored URL is dead within a day. `-banner add` downloads once into
  `.data/banners/<guildId>/<sha256>.<ext>` and everything downstream reads the file. The deploy's
  `rsync --delete` excludes `.data`, so the pool survives merges; it is *not* in the SQLite backup.
- **Banner bytes are base64-encoded in-process**, never handed to `setBanner` as a URL. discord.js will
  fetch a URL for you, but its `resolveImage` throws away the fetched content type and labels
  everything `image/jpg`, with no timeout and no size cap. `src/banner/image.ts` sniffs the real type
  from magic bytes instead.
- `-banner gallery` uses `sendLazyPager` rather than `sendPaginatedEmbed`: pages carry uploaded files,
  so building them all up front would read the whole pool into memory to show page one.
- Banner rotation is **deadline-driven, not queued** — `banner_configs.next_run_at` is the truth, and
  the scheduler polls for due rows. Catch-up is deliberately non-accumulating: a guild that was due 200
  times during an outage rotates **once** and reschedules from now. `next_run_at` also advances after a
  *failed* rotation, or a broken guild would be retried every tick forever.
- Artist crown recalculation is queued to the DB and drained by a worker, not done inline. The
  **album** crown is the exception: `-fm` settles it inline after its rank scans, because the footer
  gif has to say whether the caller holds the crown. The queued album job is enqueued first as the
  failure path and deleted once the inline scan succeeds.

## Migrations

Generate with `npm run db:generate -- --name <what_it_does>`. **Always pass `--name`** — bare
`db:generate` invents a random `<adjective>_<marvel-character>` tag, which is how `last_used` ended
up as `0002_ambiguous_roland_deschain`. That tag is the only human-readable label in `_journal.json`,
in `deploy/README.md`'s rollback steps, and in `git log`.

Two PRs open at once will both generate `000N` and collide on merge. Resolve by **regenerating, not
renumbering**: delete your `.sql` and snapshot, take `main`'s, then re-run `db:generate` so yours
chains onto the end. Renaming the files by hand leaves the journal's `when` untouched, and `when` is
load-bearing twice over — the migrator applies by it and silently skips anything at or below the
last-applied timestamp, and `scripts/migrationGuard.ts` compares it against the target tag to decide
whether a rollback is safe.

## Loop

```sh
npm run dev        # tsx watch against the dev bot
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint src test scripts
npm run smoke      # drives a running dev bot over real Discord
npm run db:pull    # read-only prod snapshot -> .data/prod/ (see deploy/README.md)
```

Tests use `nock` with net access disabled and the fakes in `test/helpers/fake.ts` (in-memory SQLite,
a fake `Message` recording replies/embeds/edits). No network in tests.

## Deploy

Merging to `main` triggers `.github/workflows/deploy.yml`: tests + build, rsync to an Oracle Cloud
VM, DB backup, `systemctl restart feed1`. CI (typecheck, lint, test, build) runs on every PR.

**Every PR merged to `main` must bump `version` in `package.json`** — docs and CI-only changes
included, as a patch. The merge tags that version and cuts a release; an unchanged version leaves
the deploy fine but turns the run red. Read [VERSIONING.md](VERSIONING.md) before choosing the
number; it owns the rules, and `deploy/README.md` covers rollback mechanics.
