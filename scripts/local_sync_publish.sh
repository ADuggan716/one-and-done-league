#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p logs .tmp
CONFIG_PATH="${ROOT_DIR}/config/config.json"
ALERT_ENV_PATH="${ALERT_ENV_PATH:-$HOME/.config/golf-sync-alert.env}"

if [[ -f "$ALERT_ENV_PATH" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ALERT_ENV_PATH"
  set +a
fi

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
COOKIE_ALERT_STATE_PATH="${ROOT_DIR}/.tmp/cookie_alert.last_sent"
COOKIE_ALERT_COOLDOWN_MINUTES="${COOKIE_ALERT_COOLDOWN_MINUTES:-720}"

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

cookie_refresh_needed() {
  local log_path="$1"
  grep -Eq "AUTH_EXPIRED|COOKIE_EMPTY|PARSE_EMPTY" "$log_path"
}

send_cookie_refresh_alert_if_needed() {
  local log_path="$1"

  if [[ -z "${ALERT_EMAIL_TO:-}" || -z "${ALERT_SMTP_USER:-}" || -z "${ALERT_SMTP_PASS:-}" ]]; then
    echo "==> Cookie alert skipped: SMTP/email env vars not configured"
    return 0
  fi

  local now_ts last_ts min_gap
  now_ts="$(date +%s)"
  last_ts=0
  if [[ -f "$COOKIE_ALERT_STATE_PATH" ]]; then
    last_ts="$(cat "$COOKIE_ALERT_STATE_PATH" 2>/dev/null || echo 0)"
  fi
  min_gap="$((COOKIE_ALERT_COOLDOWN_MINUTES * 60))"

  if (( now_ts - last_ts < min_gap )); then
    echo "==> Cookie alert skipped: cooldown active"
    return 0
  fi

  local host_name body
  host_name="$(hostname)"
  body="$(
    {
      echo "Golf sync on ${host_name} needs a Splash cookie refresh."
      echo
      echo "Project: ${ROOT_DIR}"
      echo "Time: $(date)"
      echo
      echo "Recent sync log:"
      tail -n 40 "$log_path"
    } | tr -d '\r'
  )"

  if python3 scripts/send_sync_alert.py "Golf sync needs cookie refresh (${host_name})" <<<"$body"; then
    printf '%s\n' "$now_ts" > "$COOKIE_ALERT_STATE_PATH"
    echo "==> Cookie refresh alert sent to ${ALERT_EMAIL_TO}"
  else
    echo "==> Cookie alert send failed"
  fi
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

  if cookie_refresh_needed "$LAST_LOG_PATH"; then
    send_cookie_refresh_alert_if_needed "$LAST_LOG_PATH"
  fi

  return 1
}

pick_watch_status_json() {
  node - "$CONFIG_PATH" "${ROOT_DIR}/data/league_snapshot.json" <<'NODE'
const fs = require("fs");

const [configPath, snapshotPath] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

const watch = config?.schedule?.pickVisibilityWatch || {};
const enabled = watch.enabled !== false;
const weekday = String(watch.weekday || "THURSDAY").toUpperCase();
const pollMinutes = Number.isInteger(Number(watch.pollMinutes)) ? Number(watch.pollMinutes) : 10;
const startHour = Number.isInteger(Number(watch.startHour)) ? Number(watch.startHour) : 8;
const startMinute = Number.isInteger(Number(watch.startMinute)) ? Number(watch.startMinute) : 0;
const endHour = Number.isInteger(Number(watch.endHour)) ? Number(watch.endHour) : 17;
const endMinute = Number.isInteger(Number(watch.endMinute)) ? Number(watch.endMinute) : 0;
const timezone = String(config?.schedule?.timezone || "America/New_York");

const now = new Date();
const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: timezone,
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).formatToParts(now);

const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
const currentWeekday = String(values.weekday || "").toUpperCase();
const currentMinutes = Number(values.hour || 0) * 60 + Number(values.minute || 0);
const startMinutes = startHour * 60 + startMinute;
const endMinutes = endHour * 60 + endMinute;
const watchDay = currentWeekday === weekday;
const inWindow = watchDay && currentMinutes >= startMinutes && currentMinutes <= endMinutes;
const pastWindow = watchDay && currentMinutes > endMinutes;

const members = Array.isArray(config?.subgroupMembers) ? config.subgroupMembers : [];
const rows = Array.isArray(snapshot?.event?.subgroupResults) ? snapshot.event.subgroupResults : [];
const visibleCount = rows.filter((row) => String(row?.pick || "").trim()).length;
const allVisible = members.length > 0 && visibleCount >= members.length;
const isUpcoming = Boolean(snapshot?.event?.isUpcoming);
const eventName = snapshot?.event?.name || null;

let mode = "ready";
if (enabled && watchDay && isUpcoming && !allVisible) {
  if (inWindow) mode = "wait";
  else if (pastWindow) mode = "skip";
}

process.stdout.write(JSON.stringify({
  mode,
  enabled,
  weekday,
  timezone,
  pollMinutes,
  eventName,
  isUpcoming,
  visibleCount,
  totalMembers: members.length,
  allVisible,
  inWindow,
  pastWindow,
}));
NODE
}

pick_watch_field() {
  local json="$1"
  local field="$2"
  node -e 'const payload = JSON.parse(process.argv[1]); const field = process.argv[2]; const value = payload[field]; if (typeof value === "object") console.log(JSON.stringify(value)); else console.log(String(value));' "$json" "$field"
}

wait_for_public_picks_if_needed() {
  while true; do
    local status_json
    status_json="$(pick_watch_status_json)"
    local mode event_name visible total poll_minutes
    mode="$(pick_watch_field "$status_json" "mode")"
    event_name="$(pick_watch_field "$status_json" "eventName")"
    visible="$(pick_watch_field "$status_json" "visibleCount")"
    total="$(pick_watch_field "$status_json" "totalMembers")"
    poll_minutes="$(pick_watch_field "$status_json" "pollMinutes")"

    if [[ "$mode" == "ready" ]]; then
      if [[ "$total" != "0" ]]; then
        echo "==> Pick visibility check: ${visible}/${total} subgroup picks visible for ${event_name:-current event}"
      fi
      return 0
    fi

    if [[ "$mode" == "skip" ]]; then
      echo "==> Pick visibility watch ended for ${event_name:-current event}; only ${visible}/${total} subgroup picks are public"
      echo "==> Skipping publish to avoid pushing a partial Thursday pick board"
      exit 0
    fi

    echo "==> ${event_name:-Current event}: only ${visible}/${total} subgroup picks are public"
    echo "==> Waiting ${poll_minutes} minutes and retrying until Splash exposes all subgroup picks"
    sleep "$((poll_minutes * 60))"
    echo "==> Re-running sync while Thursday pick visibility watch is active"
    run_sync_with_retries
  done
}

if [[ "$RUN_SIGNALS" == "1" ]]; then
  echo "==> Fetching online signals (non-fatal)"
  node scripts/fetch_online_signals.mjs || true
fi

echo "==> Syncing Splash data locally"
run_sync_with_retries
wait_for_public_picks_if_needed

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
