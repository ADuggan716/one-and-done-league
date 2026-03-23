#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p logs .tmp

LOCK_DIR="${ROOT_DIR}/.tmp/local_sync_publish.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "==> Another sync is already running; exiting"
  exit 1
fi
trap 'rmdir "$LOCK_DIR"' EXIT

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
COMMIT_MSG="${COMMIT_MSG:-chore: refresh league data}"
RUN_SIGNALS="${RUN_SIGNALS:-1}"
SYNC_RETRIES="${SYNC_RETRIES:-3}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-120}"
SPLASH_SOURCE="${SPLASH_SOURCE:-direct}"
ALLOW_CHROME_FALLBACK="${ALLOW_CHROME_FALLBACK:-0}"
LAST_LOG_PATH="${ROOT_DIR}/logs/local_sync_publish.last.log"

echo "==> Working directory: $ROOT_DIR"
echo "==> Branch: $BRANCH"
echo "==> Splash source: $SPLASH_SOURCE"

echo "==> Updating runner code from origin/$BRANCH"
git pull --rebase origin "$BRANCH"

run_sync_once() {
  if [[ "$SPLASH_SOURCE" == "chrome" ]]; then
    SPLASH_SOURCE=chrome node scripts/sync_runyourpool.mjs
    return
  fi

  node scripts/sync_runyourpool.mjs
}

should_retry_sync_failure() {
  local log_path="$1"

  if grep -Eq "AUTH_EXPIRED|COOKIE_EMPTY" "$log_path"; then
    return 1
  fi

  if grep -Eq "NETWORK_ERROR|PARSE_EMPTY|fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED" "$log_path"; then
    return 0
  fi

  return 1
}

run_sync_with_retries() {
  local attempt=1

  while (( attempt <= SYNC_RETRIES )); do
    echo "==> Sync attempt ${attempt}/${SYNC_RETRIES}"
    if run_sync_once 2>&1 | tee "$LAST_LOG_PATH"; then
      return 0
    fi

    if (( attempt == SYNC_RETRIES )); then
      break
    fi

    if should_retry_sync_failure "$LAST_LOG_PATH"; then
      echo "==> Retryable sync failure detected; sleeping ${RETRY_DELAY_SECONDS}s"
      sleep "$RETRY_DELAY_SECONDS"
      ((attempt+=1))
      continue
    fi

    break
  done

  if [[ "$ALLOW_CHROME_FALLBACK" == "1" && "$SPLASH_SOURCE" != "chrome" ]]; then
    echo "==> Primary sync failed; attempting one Chrome fallback run"
    if SPLASH_SOURCE=chrome node scripts/sync_runyourpool.mjs 2>&1 | tee "$LAST_LOG_PATH"; then
      return 0
    fi
  fi

  return 1
}

if [[ "$RUN_SIGNALS" == "1" ]]; then
  echo "==> Fetching online signals (non-fatal)"
  node scripts/fetch_online_signals.mjs || true
fi

echo "==> Syncing Splash data locally"
run_sync_with_retries

echo "==> Staging updated data files"
git add data/*.json

if git diff --cached --quiet; then
  echo "==> No data changes to commit"
else
  echo "==> Committing data refresh"
  git commit -m "$COMMIT_MSG"
fi

echo "==> Pushing updated data"
git push origin "$BRANCH"

echo "==> Local sync + publish complete"
