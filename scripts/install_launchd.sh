#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_LABEL="com.andrew.oneanddone.sync"
PLIST_PATH="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"
HEALTH_LABEL="com.andrew.oneanddone.sync-health"
HEALTH_PLIST_PATH="$HOME/Library/LaunchAgents/${HEALTH_LABEL}.plist"
CONFIG_PATH="${ROOT_DIR}/config/config.json"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "${ROOT_DIR}/logs"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Missing config file: $CONFIG_PATH" >&2
  exit 1
fi

SCHEDULE_XML="$(
  node -e '
    const fs = require("fs");
    const configPath = process.argv[1];
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const windows = config?.schedule?.syncWindows;
    const weekdayMap = {
      SUNDAY: 0,
      MONDAY: 1,
      TUESDAY: 2,
      WEDNESDAY: 3,
      THURSDAY: 4,
      FRIDAY: 5,
      SATURDAY: 6,
    };

    if (!Array.isArray(windows) || windows.length === 0) {
      throw new Error("config.schedule.syncWindows must contain at least one schedule entry.");
    }

    const xml = windows.map((window) => {
      const weekday = weekdayMap[String(window.weekday || "").toUpperCase()];
      const hour = Number(window.hour);
      const minute = Number(window.minute);

      if (!Number.isInteger(weekday) || !Number.isInteger(hour) || !Number.isInteger(minute)) {
        throw new Error(`Invalid sync window: ${JSON.stringify(window)}`);
      }

      return [
        "    <dict>",
        "      <key>Weekday</key>",
        `      <integer>${weekday}</integer>`,
        "      <key>Hour</key>",
        `      <integer>${hour}</integer>`,
        "      <key>Minute</key>",
        `      <integer>${minute}</integer>`,
        "    </dict>",
      ].join("\n");
    }).join("\n");

    process.stdout.write(xml);
  ' "$CONFIG_PATH"
)"

tee "$PLIST_PATH" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd ${ROOT_DIR} && bash scripts/local_sync_publish.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
${SCHEDULE_XML}
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>StandardOutPath</key>
  <string>${ROOT_DIR}/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT_DIR}/logs/launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

tee "$HEALTH_PLIST_PATH" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${HEALTH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd ${ROOT_DIR} && bash scripts/check_sync_health.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>15</integer>
  </dict>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>StandardOutPath</key>
  <string>${ROOT_DIR}/logs/launchd-health.out.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT_DIR}/logs/launchd-health.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$HEALTH_PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$HEALTH_PLIST_PATH"

echo "Installed launchd agent at $PLIST_PATH"
echo "Installed health-check launchd agent at $HEALTH_PLIST_PATH"
echo "Schedule loaded from ${CONFIG_PATH}"
echo "Command: bash scripts/local_sync_publish.sh"
