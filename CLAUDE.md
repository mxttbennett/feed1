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
- Background work (crown recalculation) is queued to the DB and drained by a worker, not done inline.

## Loop

```sh
npm run dev        # tsx watch against the dev bot
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint src test
npm run smoke      # drives a running dev bot over real Discord
```

Tests use `nock` with net access disabled and the fakes in `test/helpers/fake.ts` (in-memory SQLite,
a fake `Message` recording replies/embeds/edits). No network in tests.

## Deploy

Merging to `main` triggers `.github/workflows/deploy.yml`: tests + build, rsync to an Oracle Cloud
VM, DB backup, `systemctl restart feed1`. CI (typecheck, lint, test, build) runs on every PR.
