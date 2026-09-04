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
  "${SRC}/src" "${SRC}/package.json" "${SRC}/package-lock.json" \
  "${SRC}/Dockerfile" "${SRC}/deploy" "$REMOTE:~/snake/"

echo "==> writing remote env"
ssh -i "$KEY" "$REMOTE" "cat > ~/snake/deploy/.env" <<REMOTE_ENV
SERVER_DOMAIN=${DOMAIN}
CORS_ORIGIN=*
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
REMOTE_ENV

echo "==> building and starting"
ssh -i "$KEY" "$REMOTE" 'cd ~/snake/deploy && sudo docker compose up -d --build'

echo "==> health check"
sleep 5
curl -fsS "https://${DOMAIN}/health" && echo "  OK" || echo "  not healthy yet (TLS cert may still be issuing)"
