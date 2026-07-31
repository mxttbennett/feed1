# Deploying feed1 to Oracle Cloud (Always Free)

## 1. One-time: create the Oracle account and VM (~20 min, has to be you)

1. Sign up at <https://signup.cloud.oracle.com> (card required for identity — Always Free stays $0).
2. Pick a **home region** close to you (e.g. `us-ashburn-1`). It can't be changed later.
3. Create instance: **Compute → Instances → Create**.
   - Image: **Ubuntu 24.04**.
   - Shape: **Ampere A1.Flex** (Always Free eligible) — anything within the free 4 OCPU / 24 GB.
     The current host runs 1 OCPU / 6 GB, which is plenty; scale up for free if a build ever needs it.
   - If "Out of capacity": retry later, try another availability domain, or upgrade the account to Pay-As-You-Go (still $0 within free limits) which unlocks capacity.
   - Add your SSH public key.
4. Networking: the default VCN is fine. The bot makes only outbound connections — no ingress rules needed beyond SSH (22).
5. Note the public IP.

## 2. One-time: provision the VM

```sh
ssh ubuntu@<vm-ip>
git clone https://github.com/mxttbennett/feed1.git /tmp/feed1-src   # or scp the deploy/ dir
sudo bash /tmp/feed1-src/deploy/provision.sh
```

Then:

1. `sudo cp /tmp/feed1-src/.env.example /opt/feed1/.env && sudo nano /opt/feed1/.env`
   — fill in `DISCORD_TOKEN` (PROD bot), `LASTFM_API_KEY`, `OWNER_ID`, `PREFIX`,
   `ERROR_CHANNEL_ID`, `STATUS_CHANNEL_ID`. Then `sudo chmod 600 /opt/feed1/.env`.
   The app and its files are owned by `ubuntu` (the deploy user), which the service also runs as.
2. Create a deploy SSH keypair (`ssh-keygen -t ed25519 -f deploy_key`), append `deploy_key.pub`
   to `~ubuntu/.ssh/authorized_keys` on the VM.
3. Allow the deploy user to restart the service without a password (`sudo visudo`):
   ```
   ubuntu ALL=(root) NOPASSWD: /usr/bin/systemctl stop feed1, /usr/bin/systemctl start feed1, /usr/bin/systemctl restart feed1
   ```
4. GitHub repo secrets (Settings → Secrets → Actions):
   - `DEPLOY_HOST` = VM public IP
   - `DEPLOY_USER` = `ubuntu`
   - `DEPLOY_SSH_KEY` = contents of the private `deploy_key`
   - `DEPLOY_PATH` = `/opt/feed1`

## 3. Every deploy after that

Push to `main`. The `deploy` workflow tests, builds, stops the service, backs up the
SQLite DB, syncs the new build, installs production deps, and restarts. Migrations run
automatically at app startup.

## Versioning & releases

Every push to `main` mints a version and cuts a GitHub Release. The bump comes from the
squash-merge commit subject: `feat(...)` → minor, `<type>!:` or `BREAKING CHANGE` in the body
→ major, anything else (including non-conventional subjects) → patch. The logic lives in
`scripts/nextVersion.ts` and is unit-tested; it sits outside `src/` so it never ships to the VM.

**Git tags are the source of truth**, not `package.json` — the next version is computed from the
highest `v*` tag, so a stale checkout or a skipped write-back can't duplicate or skip a version.
The workflow stamps the version into `package.json`, commits it to `main`, *then* deploys, so
the release tag always points at the tree that actually shipped (which is what makes rolling
back to a tag viable). The Release itself is created only after `systemctl is-active` passes.

- Which version is live: `node -p "require('/opt/feed1/package.json').version"`, or `-botinfo` in Discord.
- A manual `workflow_dispatch` run deploys the checked-out tree as-is — no version, no release.
  Pass a `tag` input to roll back to a release; see [Rolling back](#rolling-back).
- `::warning::main moved during this deploy` means another PR merged mid-deploy, so the version
  write-back was skipped rather than rebased onto newer code. The tag and Release are still
  correct; `main`'s `package.json` is just one version behind and the next deploy reconciles it.

## Rolling back

```sh
gh workflow run deploy.yml -f tag=v2.0.1
```

Deploys that release tag instead of `main`. Because the tag's tree carries its own
`package.json`, the box reports the version you rolled back to. No new version is minted and no
release is created, and version sequencing is unaffected — the next merge still bumps from the
highest `v*` tag, so rolling back to `v2.0.1` while tags run to `v2.0.5` still yields `v2.0.6`.

The tag must look like `vMAJOR.MINOR.PATCH` and resolve to that exact tag; branch names and raw
SHAs are rejected before anything touches the VM.

### The migration guard

Drizzle is forward-only, and it decides what to apply by comparing against the *highest*
`created_at` in `__drizzle_migrations`. So rolling back past a migration would boot old code
against a newer schema and apply nothing — no error, just code running against a shape it was
never written for. Before deploying, the workflow compares the DB's highest applied migration
against the highest `when` in the target tag's `drizzle/meta/_journal.json` and **refuses** if the
DB is ahead. It runs before the service is stopped, so a refusal leaves the bot running.

To override, re-run with `force_across_migrations=true`:

```sh
gh workflow run deploy.yml -f tag=v2.0.1 -f force_across_migrations=true
```

That is a real risk, not a formality — only the schema-mismatch case can be forced. If the
migration state can't be read at all, the deploy refuses regardless.

### Restoring the database

Every deploy writes a pre-deploy snapshot to `/opt/feed1/.data/backups/predeploy_<timestamp>.sqlite`
(via `VACUUM INTO`, so it includes committed WAL frames) and logs the path it wrote. To restore
the newest one:

```sh
sudo systemctl stop feed1
cd /opt/feed1
cp .data/backups/predeploy_<timestamp>.sqlite .data/feed1.sqlite
rm -f .data/feed1.sqlite-wal .data/feed1.sqlite-shm
sudo systemctl start feed1
```

Restoring discards everything scrobbled since that snapshot, which is why rollback never does it
automatically.

## Discord portal checklist (once per bot application)

- Bot → Privileged Gateway Intents: enable **Server Members Intent** and
  **Message Content Intent**. The bot fails fast at startup if these are missing.

## Ops notes

- Current host: Ampere A1.Flex, 1 OCPU (ARM Neoverse-N1) / 6 GB RAM / 45 GB disk,
  Ubuntu 24.04, no swap. Public IP is in the `DEPLOY_HOST` repo secret.
- Logs: `journalctl -u feed1 -f`
- DB + rotated backups live in `/opt/feed1/.data/` (12-hourly, keeps 20), plus a
  `predeploy_*.sqlite` snapshot per deploy. All snapshots use `VACUUM INTO`.
- The whole VM is disposable: a fresh one needs only provision.sh + .env + repo secrets update.
