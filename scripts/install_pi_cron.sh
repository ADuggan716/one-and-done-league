#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_PATH="${ROOT_DIR}/config/config.json"
CRON_TAG_BEGIN="# BEGIN golf-sync"
CRON_TAG_END="# END golf-sync"
TMP_CRON="$(mktemp)"
trap 'rm -f "$TMP_CRON"' EXIT

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Missing config file: $CONFIG_PATH" >&2
  exit 1
fi

SCHEDULE_LINES="$(
  node - "$CONFIG_PATH" "$ROOT_DIR" <<'NODE'
const fs = require("fs");

const [configPath, rootDir] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const windows = config?.schedule?.syncWindows || [];
const weekdayMap = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

for (const window of windows) {
  const weekday = weekdayMap[String(window.weekday || "").toUpperCase()];
  const hour = Number(window.hour);
  const minute = Number(window.minute);
  if (!Number.isInteger(weekday) || !Number.isInteger(hour) || !Number.isInteger(minute)) continue;

  const line = `${minute} ${hour} * * ${weekday} cd ${rootDir} && bash scripts/local_sync_publish.sh >> ${rootDir}/logs/pi-cron.log 2>&1`;
  process.stdout.write(`${line}\n`);
}
NODE
)"

{
  crontab -l 2>/dev/null | awk -v begin="$CRON_TAG_BEGIN" -v end="$CRON_TAG_END" '
    $0 == begin { skip=1; next }
    $0 == end { skip=0; next }
    skip != 1 { print }
  '
  echo "$CRON_TAG_BEGIN"
  echo "PATH=/usr/local/bin:/usr/bin:/bin"
  printf '%s' "$SCHEDULE_LINES"
  echo "$CRON_TAG_END"
} > "$TMP_CRON"

crontab "$TMP_CRON"

echo "Installed Pi cron schedule from ${CONFIG_PATH}"
crontab -l | awk -v begin="$CRON_TAG_BEGIN" -v end="$CRON_TAG_END" '
  $0 == begin { show=1 }
  show == 1 { print }
  $0 == end { show=0 }
'
