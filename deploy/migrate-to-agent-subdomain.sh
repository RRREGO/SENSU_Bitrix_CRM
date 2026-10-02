#!/usr/bin/env bash
# Cut over Bitrix CRM Assistant to https://agent.goerp.pro
# Run on the VPS as root (or with sudo).
#
# Prerequisites:
#   - DNS A/AAAA for agent.goerp.pro already points at this server
#   - App already installed (/opt/bitrix-crm-assistant, /etc/bitrix-crm-assistant/env)
#   - This script is run from a checkout that contains deploy/nginx/
#
# Usage:
#   sudo ./deploy/migrate-to-agent-subdomain.sh
#   DRY_RUN=1 sudo ./deploy/migrate-to-agent-subdomain.sh

set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
CANONICAL_HOST="${CANONICAL_HOST:-agent.goerp.pro}"
LEGACY_HOSTS="${LEGACY_HOSTS:-goerp.pro www.goerp.pro}"
PUBLIC_ORIGIN="https://${CANONICAL_HOST}"
ENV_FILE="${ENV_FILE:-/etc/bitrix-crm-assistant/env}"
SERVICE_NAME="${SERVICE_NAME:-bitrix-crm-assistant}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NGINX_SITE_SRC="${REPO_ROOT}/deploy/nginx/bitrix-crm-assistant.conf"
NGINX_LOCATIONS_SRC="${REPO_ROOT}/deploy/nginx/bitrix-crm-assistant.locations.conf"
NGINX_SITE_DST="/etc/nginx/sites-available/bitrix-crm-assistant.conf"
NGINX_LOCATIONS_DST="/etc/nginx/snippets/bitrix-crm-assistant.locations.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/bitrix-crm-assistant.conf"

run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[DRY_RUN] $*"
  else
    echo "+ $*"
    "$@"
  fi
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run as root: sudo $0"
    exit 1
  fi
}

upsert_env() {
  local key="$1"
  local value="$2"
  local file="$3"
  if [[ ! -f "${file}" ]]; then
    echo "Missing env file: ${file}"
    exit 1
  fi
  if grep -qE "^${key}=" "${file}"; then
    run sed -i.bak -E "s|^${key}=.*|${key}=${value}|" "${file}"
  else
    if [[ "${DRY_RUN}" == "1" ]]; then
      echo "[DRY_RUN] append ${key}=${value} >> ${file}"
    else
      printf '\n%s=%s\n' "${key}" "${value}" >> "${file}"
    fi
  fi
}

echo "=== Migrate CRM Assistant → ${PUBLIC_ORIGIN} (DRY_RUN=${DRY_RUN}) ==="
require_root

if [[ ! -f "${NGINX_SITE_SRC}" || ! -f "${NGINX_LOCATIONS_SRC}" ]]; then
  echo "Nginx templates not found under ${REPO_ROOT}/deploy/nginx/"
  exit 1
fi

echo "--- DNS check ---"
if command -v dig >/dev/null 2>&1; then
  dig +short "${CANONICAL_HOST}" A || true
  dig +short "${CANONICAL_HOST}" AAAA || true
else
  getent hosts "${CANONICAL_HOST}" || true
fi

echo "--- install nginx configs ---"
run mkdir -p /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled
run cp "${NGINX_LOCATIONS_SRC}" "${NGINX_LOCATIONS_DST}"
run cp "${NGINX_SITE_SRC}" "${NGINX_SITE_DST}"

if [[ ! -e "${NGINX_ENABLED}" ]]; then
  run ln -s "${NGINX_SITE_DST}" "${NGINX_ENABLED}"
fi

# Enable SSL lines if certbot already issued the cert.
if [[ -f "/etc/letsencrypt/live/${CANONICAL_HOST}/fullchain.pem" ]]; then
  run sed -i -E \
    -e "s|# ssl_certificate /etc/letsencrypt/live/${CANONICAL_HOST}/fullchain.pem;|ssl_certificate /etc/letsencrypt/live/${CANONICAL_HOST}/fullchain.pem;|" \
    -e "s|# ssl_certificate_key /etc/letsencrypt/live/${CANONICAL_HOST}/privkey.pem;|ssl_certificate_key /etc/letsencrypt/live/${CANONICAL_HOST}/privkey.pem;|" \
    "${NGINX_SITE_DST}"
fi
if [[ -f "/etc/letsencrypt/live/goerp.pro/fullchain.pem" ]]; then
  run sed -i -E \
    -e 's|# ssl_certificate /etc/letsencrypt/live/goerp.pro/fullchain.pem;|ssl_certificate /etc/letsencrypt/live/goerp.pro/fullchain.pem;|' \
    -e 's|# ssl_certificate_key /etc/letsencrypt/live/goerp.pro/privkey.pem;|ssl_certificate_key /etc/letsencrypt/live/goerp.pro/privkey.pem;|' \
    "${NGINX_SITE_DST}"
fi

echo "--- update app origin ---"
upsert_env "APP_PUBLIC_ORIGIN" "${PUBLIC_ORIGIN}" "${ENV_FILE}"
upsert_env "APP_ALLOWED_ORIGINS" "${PUBLIC_ORIGIN}" "${ENV_FILE}"

echo "--- issue / renew TLS for ${CANONICAL_HOST} ---"
if command -v certbot >/dev/null 2>&1; then
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[DRY_RUN] certbot --nginx -d ${CANONICAL_HOST} --non-interactive --agree-tos --redirect || certbot certonly --nginx -d ${CANONICAL_HOST}"
  else
    # Prefer nginx plugin; fall back to certonly if plugin edits fail.
    if ! certbot --nginx -d "${CANONICAL_HOST}" --non-interactive --agree-tos --redirect; then
      certbot certonly --nginx -d "${CANONICAL_HOST}" --non-interactive --agree-tos
      sed -i -E \
        -e "s|# ssl_certificate /etc/letsencrypt/live/${CANONICAL_HOST}/fullchain.pem;|ssl_certificate /etc/letsencrypt/live/${CANONICAL_HOST}/fullchain.pem;|" \
        -e "s|# ssl_certificate_key /etc/letsencrypt/live/${CANONICAL_HOST}/privkey.pem;|ssl_certificate_key /etc/letsencrypt/live/${CANONICAL_HOST}/privkey.pem;|" \
        "${NGINX_SITE_DST}"
    fi
  fi
else
  echo "certbot not found. Install certbot + python3-certbot-nginx, then re-run."
  exit 1
fi

echo "--- nginx test + reload ---"
run nginx -t
run systemctl reload nginx

echo "--- restart app ---"
run systemctl restart "${SERVICE_NAME}"
sleep 2
run systemctl is-active "${SERVICE_NAME}"

echo "--- health checks ---"
if [[ "${DRY_RUN}" == "1" ]]; then
  echo "[DRY_RUN] curl -fsS http://127.0.0.1:3005/health"
  echo "[DRY_RUN] curl -fsSI ${PUBLIC_ORIGIN}/health"
else
  curl -fsS "http://127.0.0.1:3005/health" || true
  echo
  curl -fsSI "${PUBLIC_ORIGIN}/health" || true
  echo
fi

cat <<EOF

Done.

Next (manual):
1. Open ${PUBLIC_ORIGIN} and log in again (cookies are host-scoped).
2. In Wazzup set webhook to:
   ${PUBLIC_ORIGIN}/webhooks/wazzup/<WAZZUP_WEBHOOK_SECRET>
3. Update Bitrix24 outbound webhook URLs from goerp.pro → ${CANONICAL_HOST}.
4. If MAX bot webhook is used, set MAX_BOT_WEBHOOK_URL to the new host.
5. After providers stop hitting the apex, remove the legacy server block for:
   ${LEGACY_HOSTS}
EOF
