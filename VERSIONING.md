# Versioning

`package.json`'s `version` is the source of truth. You bump it by hand, in the PR that makes the
change. Nothing is inferred from commit messages, and CI never writes to the repo — the version
that ships is the one you reviewed.

On merge to `main`, the deploy workflow ships the build and then cuts an annotated tag
`v<version>` plus a matching [GitHub Release](../../releases) with generated notes.

## Which number to bump

| Bump | When | Examples |
|---|---|---|
| **major** | A generational rewrite, a large addition or refactor, or a breaking change of medium-or-higher scale | The 2.0 TypeScript rewrite; removing or renaming a command people use; a deploy that needs manual DB or `.env` work |
| **minor** | New user-visible behaviour, or a self-contained new command | Artist ranks in `-fm`; `-wk`/`-a`/`-plays` falling back to the last scrobble |
| **patch** | Everything else | Bug fixes, copy tweaks, refactors with no visible change, docs, CI, tests |

"Breaking" is about the people using the bot, not internal shape: renaming an exported function is
a patch, renaming `-wk` is not.

## Every merge to `main` bumps

Including docs-only and CI-only PRs — those take a patch. Two reasons: the release step **fails on
a tag that already exists**, so a merge without a bump turns `main` red; and one release per merge
keeps releases and merge commits one-to-one, which is what makes `-botinfo` a useful answer to
"what's actually running?".

Put the bump in its own final commit so it's easy to see and easy to redo after a rebase:

```sh
npm version 2.3.0 --no-git-tag-version   # updates package.json + package-lock.json
git commit -am "chore(release): 2.3.0"
```

**Two open PRs both bumping to the same number will conflict** on that line — whichever merges
second needs a rebase and a re-bump. For stacked work, branch the second PR off the first and
bump past it rather than off `main`.

## What CI does with it

The release is the **last** step, after `systemctl is-active` passes, so a version mistake can
never block shipping. If the version is malformed, already tagged (you forgot to bump), or lower
than the latest release, **the deploy still succeeds and the run goes red** with the reason. Fix it
by bumping in the next PR, or tag that commit by hand.

- Which version is live: `-botinfo` in Discord, or
  `node -p "require('/opt/feed1/package.json').version"` on the box.
- A manual `workflow_dispatch` run with no inputs deploys the checked-out tree as-is — no tag, no
  release.

## Versions as rollback targets

Every release tag is a deployable point in time: `gh workflow run deploy.yml -f tag=v2.1.0` puts
that tree on the box, and because the tag carries its own `package.json`, the bot reports the
version you rolled back to. Rolling back creates no tag and no release, and changes nothing about
sequencing — the next merge still releases whatever `main` says.

This is the practical reason patch bumps are cheap and worth spending: the more granular the
releases, the finer-grained the rollback. The limit is the database — Drizzle is forward-only, so
rolling back past a migration is refused unless forced. A change that adds a migration is a
rollback boundary, which is worth keeping in mind when deciding how much to put in one PR.

Mechanics, the migration guard, and DB restores: [deploy/README.md](deploy/README.md).
