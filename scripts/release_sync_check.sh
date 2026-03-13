#!/usr/bin/env bash
set -euo pipefail

# One-command helper:
# 1) Optional tests
# 2) Commit + push
# 3) Check deployed page (if SITE_URL is provided)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMMIT_MSG="${1:-chore: update one-and-done app}"
SKIP_TESTS="${SKIP_TESTS:-0}"
SITE_URL="${SITE_URL:-}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

echo "==> Working directory: $ROOT_DIR"
echo "==> Branch: $BRANCH"

if [[ "$SKIP_TESTS" != "1" ]]; then
  echo "==> Running tests"
  npm test
else
  echo "==> Skipping tests (SKIP_TESTS=1)"
fi

echo "==> Staging changes"
git add -A

if git diff --cached --quiet; then
  echo "==> No staged changes to commit"
else
  echo "==> Committing: $COMMIT_MSG"
  git commit -m "$COMMIT_MSG"
fi

echo "==> Pushing branch: $BRANCH"
git push origin "$BRANCH"

if [[ -n "$SITE_URL" ]]; then
  echo "==> Checking live site: $SITE_URL"
  HTTP_CODE="$(curl -sS -o /tmp/one_and_done_home.html -w "%{http_code}" "$SITE_URL")"
  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "==> Site check failed: HTTP $HTTP_CODE"
    exit 1
  fi

  if rg -q "One and Done Companion|One and Done League" /tmp/one_and_done_home.html; then
    echo "==> Site content check passed"
  else
    echo "==> Site returned 200, but expected title text not found"
    exit 1
  fi
else
  echo "==> SITE_URL not set. Skipping live webpage check."
  echo "   Example: SITE_URL='https://<your-github-username>.github.io/<repo-name>/' npm run release:sync:check -- \"feat: update picks UI\""
fi

echo "==> Done"
