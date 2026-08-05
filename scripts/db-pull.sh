#!/usr/bin/env bash
# Pull a point-in-time snapshot of the production database to .data/prod/ for
# local inspection (TablePlus, sqlite3, whatever).
#
#   npm run db:pull                 # host from PROD_SSH_HOST in .env
#   npm run db:pull -- ubuntu@1.2.3.4
#
# The remote side opens the live DB read-only and uses VACUUM INTO, which is
# safe against the running bot and cannot write to prod. What lands locally is a
# standalone file with no WAL — never a mount of, or handle on, the real thing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_APP="${PROD_APP_DIR:-/opt/feed1}"
REMOTE_DB="${PROD_DB_PATH:-$REMOTE_APP/.data/feed1.sqlite}"
DEST="$REPO_ROOT/.data/prod/feed1-prod.sqlite"

HOST="${1:-${PROD_SSH_HOST:-}}"
if [[ -z "$HOST" && -f "$REPO_ROOT/.env" ]]; then
  # `|| true`: a .env without the key must reach the message below, not trip pipefail
  HOST="$(grep -E '^PROD_SSH_HOST=' "$REPO_ROOT/.env" | tail -1 | cut -d= -f2- || true)"
  HOST="${HOST//[\"\' $'\r']/}"
fi
if [[ -z "$HOST" ]]; then
  echo "no host: pass one (npm run db:pull -- ubuntu@1.2.3.4) or set PROD_SSH_HOST in .env" >&2
  exit 1
fi
[[ "$HOST" == *@* ]] || HOST="ubuntu@$HOST"

REMOTE_TMP="/tmp/feed1-snapshot-$$.sqlite"
cleanup() { ssh "$HOST" "rm -f '$REMOTE_TMP'" </dev/null >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "snapshotting $HOST:$REMOTE_DB ..."
ssh "$HOST" bash -s -- "$REMOTE_DB" "$REMOTE_TMP" "$REMOTE_APP" <<'REMOTE'
set -euo pipefail
DB="$1"; TMP="$2"; APP="$3"
[[ -f "$DB" ]] || { echo "no database at $DB" >&2; exit 1; }
rm -f "$TMP"
node -e '
const Database = require(process.argv[3] + "/node_modules/better-sqlite3");
const db = new Database(process.argv[1], { readonly: true });
db.prepare("VACUUM INTO ?").run(process.argv[2]);
db.close();
' "$DB" "$TMP" "$APP"
REMOTE

mkdir -p "$(dirname "$DEST")"
scp -q "$HOST:$REMOTE_TMP" "$DEST.part"
# a stale -wal beside a freshly replaced file is a corrupt read; TablePlus makes them
rm -f "$DEST-wal" "$DEST-shm"
mv "$DEST.part" "$DEST"

echo "pulled $(du -h "$DEST" | cut -f1) -> ${DEST#"$REPO_ROOT/"}"
