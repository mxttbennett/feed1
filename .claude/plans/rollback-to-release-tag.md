# Plan: Rollback — redeploy a previous release tag, with a migration guard

## Context

Issue #16, follow-up to #15. #15 made every merge mint a version and cut a GitHub Release whose tag points at the tree that actually shipped, so `git checkout <tag>` is now a faithful deployable artifact. What's missing is the path to *use* one. This adds a `workflow_dispatch` tag input that redeploys a release tag, plus a guard against the one thing that makes rollback genuinely dangerous: the SQLite schema being ahead of the code being deployed. Posture chosen by the user: **refuse by default, with an explicit force escape hatch.**

Review surfaced a prerequisite: the pre-deploy DB snapshot that the force path relies on can silently lose committed data. That gets fixed here, because documenting it as a restore point otherwise promises something it doesn't deliver.

## Investigation findings

The unknown from #16 is resolved — the comparison is cheap, exact, and needs no app boot.

- **Drizzle's apply decision is a single max-timestamp comparison.** `node_modules/drizzle-orm/sqlite-core/dialect.js:577-600`: it reads `SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`, then applies a migration iff `!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis`. `folderMillis` is the journal entry's `when`.
- **Verified empirically**, not just read: migrating a fresh DB produced `__drizzle_migrations` with `{hash: "261dee07…", created_at: 1784230224030}`, exactly the `when` of `0000_loose_ultimatum` in `drizzle/meta/_journal.json`. Columns are `id`, `hash`, `created_at` (`id` is `null` because the DDL declares `id SERIAL PRIMARY KEY` and `SERIAL` isn't a SQLite type).
- **The live DB is readable over SSH while the bot runs.** Confirmed against the VM: `cd /opt/feed1 && node -e 'require("better-sqlite3")…'` with `{readonly: true}` returned `[{"hash":"261dee07…","created_at":1784230224030}]`. `better-sqlite3` is a prod dependency, so `npm ci --omit=dev` leaves it on the box, and the DB is WAL mode (`src/db/index.ts:13`), so a readonly reader doesn't contend with the service.
- **The VM has no `sqlite3` CLI** (`command -v sqlite3` → nothing), so every DB read/write must go through node + `better-sqlite3`.
- **`DB_PATH` is environment-configurable and explicitly set on the box.** `src/core/config.ts:11` declares `DB_PATH: z.string().default('.data/feed1.sqlite')`, `:57` feeds it to `config.dbPath`, and `src/index.ts:21-22` opens exactly that. The VM's `/opt/feed1/.env` sets `DB_PATH=.data/feed1.sqlite` — relative, resolved against `WorkingDirectory=/opt/feed1` (`deploy/feed1.service:9`). It matches the hardcoded path today, but hardcoding would fail silently the moment it changes, so the guard must resolve it the way the service does.
- **The pre-deploy backup can lose committed transactions.** `deploy.yml:107-109` does a plain `cp` of `$APP/.data/feed1.sqlite` only — not `-wal`. Meanwhile `src/ops/backup.ts:20-28` snapshots via `db.prepare('VACUUM INTO ?')` and its docstring calls that "safe against concurrent writers". On the live box the WAL is **4.1 MB with an mtime later than the main DB file**, and `src/index.ts`'s `shutdown()` calls `worker.stop()`, `await bot.stop()`, then `process.exit(0)` — it never closes the SQLite handle, so SIGTERM from `systemctl stop` leaves un-checkpointed frames behind. A main-file-only copy therefore omits everything committed since the last checkpoint.
- **This is why refusing is the right default.** `deploy.yml` rsyncs `drizzle/` with `--delete`, so rolling back replaces the box's migration folder with the target tag's smaller one. At startup `migrate()` compares against the *max* applied `created_at` — which is higher — so it applies nothing and boots old code against a newer schema, silently. Nothing errors.
- **A missing journal throws rather than reporting empty.** `node_modules/drizzle-orm/migrator.js:6-8`: `readMigrationFiles` throws `Can't find meta/_journal.json file` if the path doesn't exist. So a target tag predating the `drizzle/` directory is a real case the guard must classify, not a crash to ignore.
- Rollback does **not** corrupt version sequencing: #15 computes the next version from the highest `v*` tag, not `package.json`, so redeploying `v2.0.1` while tags run to `v2.0.5` still yields `v2.0.6` on the next merge.
- Rollback **does** correctly change the reported version: the checked-out tag carries its own `package.json`, staged and rsynced, so `-botinfo` and `/opt/feed1/package.json` report the rolled-back version.
- Only one migration exists today (`drizzle/meta/_journal.json` has a single `idx: 0` entry), so the refusal path cannot fire yet. It must be unit-tested rather than validated by a live rollback.
- `deploy.yml` currently has a bare `workflow_dispatch:` with no inputs, and `actions/checkout` takes whatever ref the event supplies — a `ref:` input would accept branches and raw SHAs, not just release tags.
- All versioning steps are gated on `github.event_name == 'push'`, so a dispatch run already skips version-minting and release-creation with no further work.
- `scripts/nextVersion.ts` + `test/scripts/nextVersion.test.ts` establish the pattern for CI-only logic: pure function plus env-driven CLI guard, outside `rootDir: "src"`, covered by `tsconfig.json` include and `eslint src test scripts`. `scripts/nextVersion.ts:28` also sets the precedent of *rejecting* malformed structured input rather than guessing.

## Approach

**Guard by comparing two integers: the DB's highest applied `created_at` against the highest `when` in the target tag's journal.** If the DB is strictly ahead, the schema contains migrations the target code doesn't know about — refuse. Equal is in-sync; DB behind means the target introduces new migrations that apply normally at startup, which is a forward deploy, not a rollback hazard.

This mirrors drizzle's own decision rule exactly — same field, same comparison — so the guard can't disagree with what the migrator will actually do. It reads one row over SSH and needs nothing on the VM beyond what's already installed.

**The guard fails closed at every step.** It resolves `DB_PATH` from the box's `.env` the way the service does rather than hardcoding a path; it treats a malformed or non-numeric reading as an error rather than coercing to `NaN` (where `NaN > target` is `false` and would wave a rollback through); and it validates that the requested ref is a real `v*` tag rather than trusting `ref:` to reject a branch name. A safety guard that fails open is worse than no guard, because it invites trust it hasn't earned.

Ordering: the guard runs **after SSH setup but before anything mutates the box** — before staging, before the service stop. A refused rollback leaves the bot untouched and running.

`force_across_migrations` is a separate boolean input rather than a magic tag value, so a typo in the tag field can't trigger it. When forced, the refusal downgrades to a `::warning::` and the run points at the snapshot to restore from — but since that snapshot's filename is generated later, inside the remote step, the warning refers to it by description and the backup step echoes the concrete path it wrote.

**Prerequisite fix:** the pre-deploy snapshot switches from `cp` to `VACUUM INTO` via node + `better-sqlite3`, matching what `src/ops/backup.ts` already does. Opening the DB read-write replays the WAL first, so the snapshot is complete. Without this, the force path's restore promise is hollow.

## Steps

1. **`scripts/migrationGuard.ts`** (new, CI-only) — exports `assessRollback({ appliedMax, targetMax })` → `{ safe: boolean, reason: string }`:
   - `appliedMax === null` (no table, no rows, or no DB file) → safe; nothing has been applied.
   - `targetMax === null` (target tag has no journal or an empty `entries`) with a non-null `appliedMax` → **unsafe**; the DB is ahead of a target expecting no schema.
   - `appliedMax > targetMax` → **unsafe**, quoting both values in the reason.
   - otherwise safe.
   Plus `parseMax(raw: string | undefined)`: `''`/`undefined` → `null`; anything else must be a finite non-negative safe integer or it **throws** — no `Number()` coercion to `NaN`. CLI guard reads `APPLIED_MAX`/`TARGET_MAX`, prints the reason, and exits non-zero when unsafe.
2. **`test/scripts/migrationGuard.test.ts`** (new) — all four `assessRollback` branches; equality is safe; `appliedMax < targetMax` is safe; today's single-migration state is safe against its own tag; millisecond values near `Number.MAX_SAFE_INTEGER` keep precision. For `parseMax`: empty string and `undefined` → `null`; `'abc'`, `'NaN'`, `'12.5'`, `'-1'`, `'1e21'`, and whitespace-plus-noise all throw.
3. **`.github/workflows/deploy.yml`** — add `workflow_dispatch.inputs`:
   - `tag` (string, optional) — release tag to deploy; blank deploys the selected branch as today.
   - `force_across_migrations` (boolean, default `false`).
   Then:
   - *Resolve the deploy ref* step, `if: inputs.tag != ''` — require the tag to match `^v[0-9]+\.[0-9]+\.[0-9]+$` **and** to exist as `refs/tags/<tag>` on the remote (`git ls-remote --exit-code --tags`), rejecting branches and raw SHAs with a clear `::error::`.
   - `actions/checkout` gains `ref: ${{ inputs.tag || github.ref }}`, keeping `fetch-depth: 0`.
   - Move **Set up SSH** ahead of the guard so it can reach the box.
   - New *Check migration state* step, `if: inputs.tag != ''`, before staging: `targetMax` from the checked-out `drizzle/meta/_journal.json` (empty/missing journal → empty string, never `-Infinity`); `appliedMax` over SSH via node + `better-sqlite3` `{readonly: true}`, resolving the DB path from `/opt/feed1/.env`'s `DB_PATH` (default `.data/feed1.sqlite`, resolved against `$DEPLOY_PATH`) and emitting empty for a missing file or missing table; then call the guard. Unsafe + `force_across_migrations` → `::warning::` and continue; unsafe otherwise → `::error::` and exit 1.
   - A log line naming the tag and resolved SHA being deployed.
4. **`.github/workflows/deploy.yml` (pre-deploy snapshot fix)** — replace the `cp` at the backup step with a `VACUUM INTO` through node + `better-sqlite3`, using the same `DB_PATH` resolution, and `echo` the snapshot path it wrote so the force warning has something concrete to point at. Keep the `predeploy_<ts>.sqlite` naming.
5. **`deploy/README.md`** — a "Rolling back" section: the `gh workflow run deploy.yml -f tag=v2.0.1` invocation, what the guard checks and why refusing is the default, how to force, how to restore a `predeploy_*.sqlite` snapshot, and the note that rollback doesn't disturb version sequencing. Also correct the ops note to say snapshots are `VACUUM INTO`-based.
6. **PR** — `feat(deploy): roll back to a release tag, guarded against schema drift`, `Closes #16`.

## Verification

- `npm run typecheck && npm run lint && npx vitest run` — new guard tests pass; `scripts/` stays linted and typechecked.
- `npm run build` then confirm no `migrationGuard` artifact under `dist/`.
- Exercise the CLI per branch: `APPLIED_MAX=1784230224030 TARGET_MAX=1784230224030` → safe, exit 0; `APPLIED_MAX=1799999999999 TARGET_MAX=1784230224030` → unsafe, exit 1; `APPLIED_MAX= TARGET_MAX=1784230224030` → safe; `APPLIED_MAX=oops` → throws, exit 1 (fails closed).
- Re-run the exact SSH read command against the VM and confirm it still returns `1784230224030`, including the `.env`-based path resolution.
- Verify the `VACUUM INTO` snapshot command against the live box **without stopping the service** (writing to a scratch path under `.data/backups/`), then confirm the resulting file's `__drizzle_migrations` is readable and its size is consistent with the main DB plus WAL. Delete the scratch file afterward.
- Dispatch `tag=v2.0.0` for the safe path end-to-end: guard passes (applied max equals that tag's journal max), `-botinfo` still reports `2.0.0`, service active, and **no** new release or tag is created.
- Confirm tag validation rejects a branch: dispatch with `tag=main` should fail at the resolve step before touching the box.

## Risks & open questions

- **The refusal path can't be integration-tested yet** — one migration means `appliedMax > targetMax` is unreachable in production. Unit tests cover it; first real exercise is the first rollback across a `0001_*` migration.
- **A forced rollback is genuinely unsafe and the workflow can't make it safe.** It warns and points at the snapshot; it does not auto-restore, because that would silently discard every scrobble since.
- **The snapshot fix changes a step that currently "works".** If `VACUUM INTO` fails on the box (disk, permissions), the deploy fails at the backup step rather than proceeding with a weaker copy — deliberate, but it makes backup failures deploy-blocking where they previously weren't.
- **Deleting a release tag breaks rollback to it**, same invariant #15 documented.
- **The guard trusts the journal, not the SQL files.** A migration edited in place without changing its `when` reads as applied to both drizzle and this guard. Out of scope, consistent with drizzle.
- Rolling back leaves `main`'s `package.json` ahead of what's deployed. Intended — the box reports what's running — but `-botinfo` becomes the authority on the live version.

## Out of scope

- Auto-restoring the DB as part of rollback (option 3 from #16) — too destructive to automate.
- Reverse/down migrations. Drizzle is forward-only and this doesn't change that.
- Rolling back to an arbitrary commit rather than a release tag.
- Closing the SQLite handle on shutdown in `src/index.ts`. It's the root cause of the lingering WAL and worth fixing, but it's an app-lifecycle change and the `VACUUM INTO` snapshot makes the backup correct regardless.
- Any change to how forward deploys version, tag, or release.

## Review notes

Reviewed by Codex on 2026-07-31, 1 of 1 cycles.

**Cycle 1** — 6 findings: 4 accepted, 2 modified, 0 rejected.

- Accepted (blocker): guard could read the wrong DB because `DB_PATH` is configurable. Verified `src/core/config.ts:11`/`:57` and found the VM's `.env` *does* set `DB_PATH`, so the guard now resolves it from `.env` and fails closed.
- Accepted (important): reuse the existing `VACUUM INTO` approach instead of the workflow's raw `cp`. Verified `src/ops/backup.ts:20-28` versus `deploy.yml:107-109`, plus a 4.1 MB live WAL and a `shutdown()` that never closes the handle — added as step 4, a scoped prerequisite.
- Accepted (important): the `tag` input wasn't validated as a release tag; `ref:` would accept branches and SHAs. Added a semver + `git ls-remote` check before checkout.
- Accepted (important): `Number()` coercion could yield `NaN` and fail open. Added `parseMax` with explicit rejection and tests for each malformed form.
- Accepted, modified (important): the force warning can't name a backup path that doesn't exist yet. Rather than moving the backup earlier, the warning describes the snapshot and the backup step echoes the concrete path it wrote.
- Accepted, modified (important): "only decision logic has edge cases" was unsupported. Rather than testing shell one-liners, added investigation findings for each data-source contract (`DB_PATH` resolution, missing journal throwing at `migrator.js:6-8`, missing table/file) and specified the failure behavior for each.
