#!/usr/bin/env bash
# Push the game server to the OCI box and (re)start it.
#
#   ./server/deploy/deploy.sh <public-ip> <domain>
#
# Reads secrets from server/.env. Idempotent — safe to re-run for updates.
set -euo pipefail

IP="${1:?usage: deploy.sh <public-ip> <domain>}"
DOMAIN="${2:?usage: deploy.sh <public-ip> <domain>}"
KEY="$HOME/.ssh/snake_hyd"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="ubuntu@${IP}"

# shellcheck disable=SC1091
set -a; source "${SRC}/.env"; set +a

echo "==> waiting for cloud-init to finish on ${IP}"
until ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
      "$REMOTE" 'test -f /var/log/cloud-init-done' 2>/dev/null; do
  echo "    still booting..."; sleep 15
done

echo "==> syncing source"
ssh -i "$KEY" "$REMOTE" 'mkdir -p ~/snake'
rsync -az --delete -e "ssh -i $KEY" \
  --exclude node_modules --exclude .env --exclude test \
  "${SRC}/src" "${SRC}/db" "${SRC}/package.json" "${SRC}/package-lock.json" \
  "${SRC}/Dockerfile" "${SRC}/deploy" "$REMOTE:~/snake/"

echo "==> writing remote env"
: "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in server/.env}"
: "${AUTH_JWT_SECRET:?set AUTH_JWT_SECRET in server/.env (openssl rand -hex 32)}"

ssh -i "$KEY" "$REMOTE" "cat > ~/snake/deploy/.env" <<REMOTE_ENV
SERVER_DOMAIN=${DOMAIN}
CORS_ORIGIN=*
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
AUTH_JWT_SECRET=${AUTH_JWT_SECRET}
GOOGLE_WEB_CLIENT_ID=${GOOGLE_WEB_CLIENT_ID:-}
FREE_ROOMS_PER_DAY=${FREE_ROOMS_PER_DAY:-2}
CREDITS_TIMEZONE=${CREDITS_TIMEZONE:-Asia/Kolkata}
REMOTE_ENV

echo "==> building and starting"
ssh -i "$KEY" "$REMOTE" 'cd ~/snake/deploy && sudo docker compose up -d --build'

echo "==> installing the nightly backup timer (idempotent)"
# A systemd timer rather than cron: this Ubuntu image ships without the cron
# package, and systemd is already there. Same 03:15 schedule, and it survives a
# reboot without an fstab-style edit.
ssh -i "$KEY" "$REMOTE" 'set -e
  chmod +x ~/snake/deploy/backup.sh
  sudo tee /etc/systemd/system/snake-backup.service >/dev/null <<UNIT
[Unit]
Description=Nightly pg_dump of the snake database
After=docker.service

[Service]
Type=oneshot
User=ubuntu
ExecStart=/home/ubuntu/snake/deploy/backup.sh
UNIT
  sudo tee /etc/systemd/system/snake-backup.timer >/dev/null <<UNIT
[Unit]
Description=Run the snake database backup nightly

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now snake-backup.timer
  systemctl list-timers snake-backup.timer --no-pager | head -2
'

echo "==> health check"
sleep 5
curl -fsS "https://${DOMAIN}/health" && echo "  OK" || echo "  not healthy yet (TLS cert may still be issuing)"
