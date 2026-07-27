#!/usr/bin/env bash
# One-time provisioning for the feed1 host (Ubuntu 22.04/24.04, x64 or ARM).
# Run as the deploy user with sudo: bash provision.sh
set -euo pipefail

APP_DIR=/opt/feed1
DEPLOY_USER="${SUDO_USER:-ubuntu}"

echo "== installing Node 22 =="
# NodeSource's setup script 403s from some cloud IPs, so install the official
# binary tarball directly.
if ! command -v node >/dev/null || [[ "$(node --version)" != v22* && "$(node --version)" != v2[3-9]* ]]; then
  case "$(uname -m)" in
    aarch64) NODE_ARCH=arm64 ;;
    x86_64)  NODE_ARCH=x64 ;;
    *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
  esac
  NODE_TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ \
    | grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-${NODE_ARCH}\.tar\.xz" | head -1)
  curl -fsSLO "https://nodejs.org/dist/latest-v22.x/${NODE_TARBALL}"
  sudo tar -xJf "${NODE_TARBALL}" -C /usr/local --strip-components=1
  sudo ln -sf /usr/local/bin/node /usr/bin/node
  sudo ln -sf /usr/local/bin/npm /usr/bin/npm
  sudo ln -sf /usr/local/bin/npx /usr/bin/npx
  rm -f "${NODE_TARBALL}"
fi

echo "== canvas build dependencies (fallback if prebuilt binaries are unavailable) =="
sudo apt-get update
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev rsync

echo "== app directory =="
sudo mkdir -p "$APP_DIR/.data/backups"
sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo "== systemd unit =="
sudo cp "$(dirname "$0")/feed1.service" /etc/systemd/system/feed1.service
sudo systemctl daemon-reload
sudo systemctl enable feed1

cat <<'NEXT'
== next steps ==
1. Create /opt/feed1/.env (copy .env.example) with the PROD token, Last.fm key,
   OWNER_ID, ERROR_CHANNEL_ID, STATUS_CHANNEL_ID. chmod 600.
2. Allow the deploy user to restart the service without a password (visudo):
     ubuntu ALL=(root) NOPASSWD: /usr/bin/systemctl stop feed1, /usr/bin/systemctl start feed1, /usr/bin/systemctl restart feed1
3. Set GitHub repo secrets: DEPLOY_HOST, DEPLOY_USER=ubuntu, DEPLOY_SSH_KEY, DEPLOY_PATH=/opt/feed1
4. Push to master — the deploy workflow does the rest.
NEXT
