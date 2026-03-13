#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
COMMIT_MSG="${COMMIT_MSG:-chore: refresh league data}"
RUN_SIGNALS="${RUN_SIGNALS:-1}"

echo "==> Working directory: $ROOT_DIR"
echo "==> Branch: $BRANCH"

if [[ "$RUN_SIGNALS" == "1" ]]; then
  echo "==> Fetching online signals (non-fatal)"
  node scripts/fetch_online_signals.mjs || true
fi

echo "==> Syncing Splash data locally"
SPLASH_SOURCE="${SPLASH_SOURCE:-chrome}" node scripts/sync_runyourpool.mjs

echo "==> Staging updated data files"
git add data/*.json

if git diff --cached --quiet; then
  echo "==> No data changes to commit"
  exit 0
fi

echo "==> Committing data refresh"
git commit -m "$COMMIT_MSG"

echo "==> Rebasing onto latest origin/$BRANCH"
git pull --rebase origin "$BRANCH"

echo "==> Pushing updated data"
git push origin "$BRANCH"

echo "==> Local sync + publish complete"
