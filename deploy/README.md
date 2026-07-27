# Deploying feed1 to Oracle Cloud (Always Free)

## 1. One-time: create the Oracle account and VM (~20 min, has to be you)

1. Sign up at <https://signup.cloud.oracle.com> (card required for identity — Always Free stays $0).
2. Pick a **home region** close to you (e.g. `us-ashburn-1`). It can't be changed later.
3. Create instance: **Compute → Instances → Create**.
   - Image: **Ubuntu 24.04**.
   - Shape: **Ampere A1.Flex** (Always Free eligible), e.g. 2 OCPU / 12 GB — anything within the free 4 OCPU / 24 GB.
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

## Discord portal checklist (once per bot application)

- Bot → Privileged Gateway Intents: enable **Server Members Intent** and
  **Message Content Intent**. The bot fails fast at startup if these are missing.

## Ops notes

- Logs: `journalctl -u feed1 -f`
- DB + rotated backups live in `/opt/feed1/.data/` (12-hourly, keeps 20).
- The whole VM is disposable: a fresh one needs only provision.sh + .env + repo secrets update.
