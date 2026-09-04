#!/usr/bin/env bash
# Nightly Postgres dump. Runs ON the OCI box, not from a laptop.
#
# Supabase did point-in-time recovery for us; a single free-tier VM does not, so
# this is the whole disaster-recovery story. Install it:
#
#   chmod +x ~/snake/deploy/backup.sh
#   (crontab -l 2>/dev/null; echo "15 3 * * * ~/snake/deploy/backup.sh >> ~/snake-backup.log 2>&1") | crontab -
#
# Restore (destructive — it drops what is there):
#
#   gunzip -c ~/snake-backups/snake-YYYY-MM-DD.sql.gz \
#     | sudo docker compose -f ~/snake/deploy/docker-compose.yml exec -T db psql -U snake -d snake
set -euo pipefail

DIR="${BACKUP_DIR:-$HOME/snake-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE="$(cd "$(dirname "$0")" && pwd)/docker-compose.yml"

mkdir -p "$DIR"
OUT="$DIR/snake-$(date +%F).sql.gz"

# --clean --if-exists so the dump can be replayed over an existing database.
sudo docker compose -f "$COMPOSE" exec -T db \
  pg_dump -U snake -d snake --clean --if-exists \
  | gzip > "$OUT.tmp"

# Only publish the file once the dump succeeded — a truncated .sql.gz that looks
# like a backup is worse than an obviously missing one.
mv "$OUT.tmp" "$OUT"
echo "$(date -Is)  wrote $OUT ($(du -h "$OUT" | cut -f1))"

find "$DIR" -name 'snake-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
