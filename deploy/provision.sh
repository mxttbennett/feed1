#!/usr/bin/env bash
# One-time provisioning for the feed1 host (Ubuntu 22.04/24.04, x64 or ARM).
# Run as a sudo-capable user: bash provision.sh
set -euo pipefail

APP_DIR=/opt/feed1

echo "== installing Node 22 =="
if ! command -v node >/dev/null || [[ "$(node --version)" != v22* && "$(node --version)" != v2[3-9]* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "== canvas build dependencies (fallback if prebuilt binaries are unavailable) =="
sudo apt-get update
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev rsync

echo "== app user and directory =="
sudo useradd --system --create-home --shell /usr/sbin/nologin feed1 2>/dev/null || true
sudo mkdir -p "$APP_DIR/.data/backups"
sudo chown -R feed1:feed1 "$APP_DIR"

echo "== systemd unit =="
sudo cp "$(dirname "$0")/feed1.service" /etc/systemd/system/feed1.service
sudo systemctl daemon-reload
sudo systemctl enable feed1

cat <<'NEXT'
== next steps ==
1. Create /opt/feed1/.env (copy .env.example) with the PROD token, Last.fm key,
   OWNER_ID, ERROR_CHANNEL_ID, STATUS_CHANNEL_ID. chmod 600, chown feed1.
2. Add the deploy user's SSH public key to ~/.ssh/authorized_keys and allow
   passwordless 'sudo systemctl stop feed1' / 'start feed1' via visudo:
     deploy ALL=(root) NOPASSWD: /usr/bin/systemctl stop feed1, /usr/bin/systemctl start feed1
3. Set GitHub repo secrets: DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY, DEPLOY_PATH=/opt/feed1
4. Push to master — the deploy workflow does the rest.
NEXT
