# Changelog

Newest release first. Every merge to `main` adds an entry here in the same commit that bumps
`version` in `package.json` — see [VERSIONING.md](VERSIONING.md) for which number to pick.
`-changelog` reads this file from inside Discord, and each GitHub release takes its notes from the
matching section.

Entry format: `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD`, then one `-` bullet per change, written for the
people using the bot rather than for the diff.

## [2.7.0] - 2026-08-20

- `-changelog` (alias `-changes`) pages through this file in Discord, newest release first.
- GitHub release notes now come from the changelog entry for that version when one exists.

## [2.6.3] - 2026-08-20

- Command runs are tallied per user and per command.

## [2.6.2] - 2026-08-20

- Dropped an unused image asset from the repo.

## [2.6.1] - 2026-08-14

- `npm run img:pull` copies the production banner images down to a local archive.

## [2.6.0] - 2026-08-14

- The banner image pool is no longer capped per server.

## [2.5.0] - 2026-08-14

- `-banner` builds a pool of images and rotates the server banner through them on an interval you
  choose. Images live on the bot's own disk, so nothing depends on a third-party host staying up.

## [2.4.0] - 2026-08-14

- The bot records when each user last ran a command.

## [2.3.4] - 2026-08-05

- `-rand` and `-wrand` show one pick per page.

## [2.3.3] - 2026-08-05

- Renamed the crowns table to `artist_crowns`. No visible change.

## [2.3.2] - 2026-08-05

- Documented that `db:pull` needs an ssh config entry.

## [2.3.1] - 2026-08-05

- `npm run db:pull` takes a read-only snapshot of the production database for local querying.

## [2.3.0] - 2026-08-03

- `-fm` settles the album crown inline, so the footer gif stops guessing at who holds it.

## [2.2.1] - 2026-08-03

- Turned off commit and PR attribution at the repo level.

## [2.2.0] - 2026-08-03

- `-wk` and `-plays` fall back to your last scrobbled track when nothing is playing.
- Added VERSIONING.md as the single source of truth for version bumps.

## [2.1.0] - 2026-08-03

- `package.json` is the source of truth for releases; each merge tags and publishes that version.
- A release tag can be redeployed as a rollback, guarded against database schema drift.

## [2.0.0] - 2026-07-31

- Rewrote the bot as feed1: TypeScript on discord.js v14, with SQLite through Drizzle and
  migrations applied at startup. The pre-rewrite JavaScript is preserved at the `legacy` tag.
- `-fm` shows artist ranks alongside album ranks.
- `-logs` reads recent bot logs from journald (owner only).
- Artist and album crowns key on Last.fm's canonical names, so spelling variants no longer split a
  crown.
- `-wk` uses the member cache instead of a gateway fetch, which stopped it hitting rate limits.
