#!/usr/bin/env bash
# Pull the production banner image pool to .data/prod/ — a tree plus a zip of it.
#
#   npm run img:pull                 # host from PROD_SSH_HOST in .env
#   npm run img:pull -- ubuntu@1.2.3.4
#
# These images are in no other backup: the 12-hourly VACUUM INTO covers the SQLite
# file only, and the deploy's rsync excludes .data entirely. Restoring a pool needs
# BOTH this and a db:pull — the files are named by content hash, so the
# banner_images rows are what map them back to guilds and ids.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_APP="${PROD_APP_DIR:-/opt/feed1}"
# the bot derives this from dirname(DB_PATH); override if prod's layout ever moves
REMOTE_BANNERS="${PROD_BANNERS_PATH:-$REMOTE_APP/.data/banners}"
DEST_DIR="$REPO_ROOT/.data/prod/banners"
DEST_ZIP="$REPO_ROOT/.data/prod/banners.zip"

HOST="${1:-${PROD_SSH_HOST:-}}"
if [[ -z "$HOST" && -f "$REPO_ROOT/.env" ]]; then
  # `|| true`: a .env without the key must reach the message below, not trip pipefail
  HOST="$(grep -E '^PROD_SSH_HOST=' "$REPO_ROOT/.env" | tail -1 | cut -d= -f2- || true)"
  HOST="${HOST//[\"\' $'\r']/}"
fi
if [[ -z "$HOST" ]]; then
  echo "no host: pass one (npm run img:pull -- ubuntu@1.2.3.4) or set PROD_SSH_HOST in .env" >&2
  exit 1
fi
[[ "$HOST" == *@* ]] || HOST="ubuntu@$HOST"

# fail with something readable rather than letting rsync error on a missing path
ssh "$HOST" bash -s -- "$REMOTE_BANNERS" <<'REMOTE'
set -euo pipefail
DIR="$1"
[[ -d "$DIR" ]] || { echo "no banner directory at $DIR" >&2; exit 1; }
[[ -n "$(find "$DIR" -type f -print -quit)" ]] || { echo "no banner images in $DIR" >&2; exit 1; }
REMOTE

echo "pulling $HOST:$REMOTE_BANNERS ..."
mkdir -p "$DEST_DIR"
# no --delete: this is the only copy of these files, so a pull that follows an
# accidental `-banner remove all` must not propagate the deletion into the backup
rsync -az --stats "$HOST:$REMOTE_BANNERS/" "$DEST_DIR/" | tail -3

# store.add() writes bytes straight to their final path, so a concurrent `-banner add`
# can be captured mid-write. The filename is the sha256 of the contents, so a torn
# file is detectable locally with no remote cooperation.
echo "verifying ..."
corrupt=0
total=0
bytes=0
while IFS= read -r file; do
  expected="$(basename "$file")"
  # only store.add() output is content-addressed, so only it can be checked this way.
  # Finder drops .DS_Store into any directory it renders, and `${name%.*}` leaves ".DS"
  # — a stem that can never be a digest, which read as corruption on every pull.
  [[ "$expected" =~ ^[0-9a-f]{64}\.[a-z0-9]+$ ]] || continue
  total=$((total + 1))
  bytes=$((bytes + $(wc -c <"$file")))
  expected="${expected%.*}"
  actual="$(shasum -a 256 "$file" | cut -d' ' -f1)"
  if [[ "$actual" != "$expected" ]]; then
    corrupt=$((corrupt + 1))
    echo "  CORRUPT ${file#"$DEST_DIR/"}" >&2
    # rsync matches on size+mtime, so a same-size corruption would be skipped on every
    # later run. Move it aside so the next pull refetches — renamed, not deleted:
    # prod's copy may be gone too, and a bad copy still beats none.
    mv "$file" "$file.corrupt"
  fi
done < <(find "$DEST_DIR" -type f)

rm -f "$DEST_ZIP.part"
(cd "$DEST_DIR" && zip -r -q -X "$DEST_ZIP.part" . -x '*.corrupt' '*.DS_Store') >/dev/null
mv "$DEST_ZIP.part" "$DEST_ZIP"

guilds="$(find "$DEST_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
# apparent size, not `du` — du reports block allocation, which for one big archive
# on APFS reads ~7% above the real byte count and makes the zip look bloated
human() { awk -v b="$1" 'BEGIN { printf "%.0f MB", b / 1048576 }'; }
echo "pulled $total file(s) across $guilds guild(s) — $(human "$bytes") tree, $(human "$(wc -c <"$DEST_ZIP")") zip"
echo "  ${DEST_DIR#"$REPO_ROOT/"}"
echo "  ${DEST_ZIP#"$REPO_ROOT/"}"

if (( corrupt > 0 )); then
  echo "$corrupt file(s) failed verification and were left out of the zip — re-run to refetch" >&2
  exit 1
fi
echo "all $total file(s) match their content hash"
