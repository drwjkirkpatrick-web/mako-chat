#!/usr/bin/env bash
# MAKO CHAT — nightly backup: PostgreSQL dump + media archive.
#
# NOTE: install this in ROOT's crontab (sudo crontab -e), not the user's:
# the media files are owned by the Synapse container's user, and only root
# can read them all from the host.
#
#   30 2 * * *  cd /path/to/mako-chat/server && bash backup.sh >> backups/backup.log 2>&1
#
# Keeps the newest 14 of each archive. ALSO copy backups/ off this machine
# regularly — a backup that lives only on the machine it backs up is not
# a backup (deploy.md section 9).
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source .env

mkdir -p backups
STAMP="$(date +%Y-%m-%d_%H%M)"

echo "==> [${STAMP}] dumping database..."
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "backups/mako-db-${STAMP}.sql.gz"

echo "==> [${STAMP}] archiving shared files (media store)..."
tar -C data/synapse -czf "backups/mako-media-${STAMP}.tar.gz" media_store

ls -1t backups/mako-db-*.sql.gz    | tail -n +15 | xargs -r rm
ls -1t backups/mako-media-*.tar.gz | tail -n +15 | xargs -r rm

echo "==> [${STAMP}] done. Latest backups:"
ls -lh backups | tail -4
