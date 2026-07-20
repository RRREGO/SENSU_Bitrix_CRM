#!/usr/bin/env bash
# Deploy release via symlink switch. DRY_RUN=1 — только вывод команд.
# NO automatic sqlite downgrade on rollback.
set -euo pipefail

APP_NAME="${APP_NAME:-bitrix-crm-assistant}"
APP_ROOT="${APP_ROOT:-/opt/${APP_NAME}}"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
PREVIOUS_LINK="${APP_ROOT}/previous"
SERVICE_NAME="${SERVICE_NAME:-bitrix-crm-assistant}"
READINESS_URL="${READINESS_URL:-http://127.0.0.1:3005/health/readiness}"
RUN_TESTS="${RUN_TESTS:-1}"
DRY_RUN="${DRY_RUN:-0}"

RELEASE_ID="${1:-}"
if [[ -z "${RELEASE_ID}" ]]; then
  echo "Usage: RELEASE_ID=<id> $0  OR  $0 <release-id>"
  exit 1
fi

RELEASE_PATH="${RELEASES_DIR}/${RELEASE_ID}"
if [[ ! -d "${RELEASE_PATH}" ]]; then
  echo "Release directory not found: ${RELEASE_PATH}"
  exit 1
fi

run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[DRY_RUN] $*"
  else
    echo "+ $*"
    "$@"
  fi
}

echo "=== Deploy ${RELEASE_ID} → ${APP_ROOT} (DRY_RUN=${DRY_RUN}) ==="

cd "${RELEASE_PATH}"

echo "--- npm ci ---"
run npm ci --omit=dev

if [[ "${RUN_TESTS}" == "1" ]]; then
  echo "--- optional tests ---"
  run npm run test:pilot
fi

echo "--- pre-deploy backup ---"
run node scripts/backup-database.js
run node scripts/check-database-backup.js

PREVIOUS_TARGET=""
if [[ -L "${CURRENT_LINK}" ]]; then
  PREVIOUS_TARGET="$(readlink -f "${CURRENT_LINK}" || true)"
fi

echo "--- symlink switch ---"
run ln -sfn "${RELEASE_PATH}" "${CURRENT_LINK}.next"
run mv -Tf "${CURRENT_LINK}.next" "${CURRENT_LINK}"

if [[ -n "${PREVIOUS_TARGET}" ]]; then
  run ln -sfn "${PREVIOUS_TARGET}" "${PREVIOUS_LINK}"
fi

echo "--- restart service ---"
run sudo systemctl restart "${SERVICE_NAME}.service"

echo "--- readiness check ---"
READY=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[DRY_RUN] curl -sf ${READINESS_URL}"
    READY=1
    break
  fi
  if curl -sf "${READINESS_URL}" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 3
done

if [[ "${READY}" != "1" ]]; then
  echo "ERROR: readiness failed — rolling back symlink (no sqlite downgrade)"
  if [[ -n "${PREVIOUS_TARGET}" && -d "${PREVIOUS_TARGET}" ]]; then
    run ln -sfn "${PREVIOUS_TARGET}" "${CURRENT_LINK}"
    run sudo systemctl restart "${SERVICE_NAME}.service"
  else
    echo "WARNING: no previous release to rollback to"
  fi
  exit 1
fi

echo "=== Deploy OK: ${RELEASE_ID} ==="
