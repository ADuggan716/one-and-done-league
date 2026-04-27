#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

AGENT_LABEL="${AGENT_LABEL:-com.andrew.oneanddone.sync}"
PLIST_PATH="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"
CONFIG_PATH="${ROOT_DIR}/config/config.json"
ALERT_ENV_PATH="${ALERT_ENV_PATH:-$HOME/.config/golf-sync-alert.env}"
SUCCESS_STATE_PATH="${ROOT_DIR}/.tmp/last_successful_sync_epoch"
HEALTH_ALERT_STATE_PATH="${ROOT_DIR}/.tmp/sync_health_alert.last_sent"
HEALTH_ALERT_COOLDOWN_MINUTES="${HEALTH_ALERT_COOLDOWN_MINUTES:-720}"
HEALTH_GRACE_MINUTES="${HEALTH_GRACE_MINUTES:-90}"

mkdir -p logs .tmp

if [[ -f "$ALERT_ENV_PATH" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ALERT_ENV_PATH"
  set +a
fi

health_status_json() {
  node - "$CONFIG_PATH" "$SUCCESS_STATE_PATH" "${ROOT_DIR}/logs/sync.log" "$PLIST_PATH" "$AGENT_LABEL" "$HEALTH_GRACE_MINUTES" <<'NODE'
const fs = require("fs");
const { execSync } = require("child_process");

const [configPath, successStatePath, syncLogPath, plistPath, agentLabel, graceMinutesArg] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const graceMinutes = Number(graceMinutesArg || 90);
const windows = Array.isArray(config?.schedule?.syncWindows) ? config.schedule.syncWindows : [];
const weekdayMap = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

const now = new Date();
const nowMs = now.getTime();
let latestExpectedMs = null;
let latestExpectedLabel = null;

for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() - dayOffset);

  for (const window of windows) {
    const weekday = weekdayMap[String(window?.weekday || "").toUpperCase()];
    const hour = Number(window?.hour);
    const minute = Number(window?.minute);
    if (!Number.isInteger(weekday) || !Number.isInteger(hour) || !Number.isInteger(minute)) continue;
    if (base.getDay() !== weekday) continue;

    const candidate = new Date(base);
    candidate.setHours(hour, minute, 0, 0);
    const candidateMs = candidate.getTime();
    if (candidateMs > nowMs) continue;
    if (latestExpectedMs === null || candidateMs > latestExpectedMs) {
      latestExpectedMs = candidateMs;
      latestExpectedLabel = `${String(window.weekday).toUpperCase()} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
}

let launchctlLoaded = false;
try {
  execSync(`launchctl print gui/${process.getuid()}/${agentLabel}`, { stdio: "pipe" });
  launchctlLoaded = true;
} catch {
  launchctlLoaded = false;
}

let lastSuccessEpoch = null;
if (fs.existsSync(successStatePath)) {
  const raw = fs.readFileSync(successStatePath, "utf8").trim();
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) lastSuccessEpoch = parsed;
}

if (!lastSuccessEpoch && fs.existsSync(syncLogPath)) {
  const matches = fs.readFileSync(syncLogPath, "utf8").match(/\[([^\]]+)\] Sync complete\./g);
  const latest = matches?.at(-1)?.match(/\[([^\]]+)\]/)?.[1];
  if (latest) {
    const parsed = Date.parse(latest);
    if (Number.isFinite(parsed)) {
      lastSuccessEpoch = Math.floor(parsed / 1000);
    }
  }
}

const issues = [];
if (!fs.existsSync(plistPath)) {
  issues.push(`LaunchAgent plist missing at ${plistPath}`);
}
if (!launchctlLoaded) {
  issues.push(`launchctl does not show ${agentLabel} as loaded`);
}

if (latestExpectedMs !== null) {
  const graceMs = graceMinutes * 60 * 1000;
  const deadlineMs = latestExpectedMs + graceMs;
  if (nowMs > deadlineMs) {
    if (!lastSuccessEpoch) {
      issues.push(`No successful sync heartbeat recorded after expected window ${latestExpectedLabel}`);
    } else if ((lastSuccessEpoch * 1000) < latestExpectedMs) {
      issues.push(`Latest successful sync was before expected window ${latestExpectedLabel}`);
    }
  }
}

process.stdout.write(JSON.stringify({
  ok: issues.length === 0,
  issues,
  agentLabel,
  plistPath,
  latestExpectedAt: latestExpectedMs ? new Date(latestExpectedMs).toISOString() : null,
  latestExpectedLabel,
  lastSuccessAt: lastSuccessEpoch ? new Date(lastSuccessEpoch * 1000).toISOString() : null,
  graceMinutes,
}, null, 2));
NODE
}

send_health_alert_if_needed() {
  local payload="$1"

  if [[ -z "${ALERT_EMAIL_TO:-}" || -z "${ALERT_SMTP_USER:-}" || -z "${ALERT_SMTP_PASS:-}" ]]; then
    echo "==> Health alert skipped: SMTP/email env vars not configured"
    return 0
  fi

  local now_ts last_ts min_gap
  now_ts="$(date +%s)"
  last_ts=0
  if [[ -f "$HEALTH_ALERT_STATE_PATH" ]]; then
    last_ts="$(cat "$HEALTH_ALERT_STATE_PATH" 2>/dev/null || echo 0)"
  fi
  min_gap="$((HEALTH_ALERT_COOLDOWN_MINUTES * 60))"

  if (( now_ts - last_ts < min_gap )); then
    echo "==> Health alert skipped: cooldown active"
    return 0
  fi

  local host_name body
  host_name="$(hostname)"
  body="$(
    node -e '
      const payload = JSON.parse(process.argv[1]);
      const lines = [
        `Golf sync health check failed on ${process.argv[2]}.`,
        "",
        `Project: ${process.argv[3]}`,
        `Time: ${new Date().toString()}`,
        "",
        "Issues:",
        ...payload.issues.map((issue) => `- ${issue}`),
        "",
        `Last successful sync: ${payload.lastSuccessAt || "none recorded"}`,
        `Latest expected sync window: ${payload.latestExpectedAt || "unknown"}${payload.latestExpectedLabel ? ` (${payload.latestExpectedLabel})` : ""}`,
        `LaunchAgent plist: ${payload.plistPath}`,
      ];
      process.stdout.write(lines.join("\n"));
    ' "$payload" "$host_name" "$ROOT_DIR" | tr -d '\r'
  )"

  if python3 scripts/send_sync_alert.py "Golf sync health check failed (${host_name})" <<<"$body"; then
    printf '%s\n' "$now_ts" > "$HEALTH_ALERT_STATE_PATH"
    echo "==> Health alert sent to ${ALERT_EMAIL_TO}"
  else
    echo "==> Health alert send failed"
  fi
}

STATUS_JSON="$(health_status_json)"
echo "$STATUS_JSON"

if node -e 'const payload = JSON.parse(process.argv[1]); process.exit(payload.ok ? 0 : 1);' "$STATUS_JSON"; then
  echo "==> Sync health check passed"
else
  send_health_alert_if_needed "$STATUS_JSON"
  exit 1
fi
