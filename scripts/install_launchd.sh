#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_LABEL="com.andrew.oneanddone.sync"
PLIST_PATH="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" <<PLIST
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
    <string>cd ${ROOT_DIR} && node scripts/fetch_online_signals.mjs && node scripts/sync_runyourpool.mjs</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>5</integer>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>StandardOutPath</key>
  <string>${ROOT_DIR}/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT_DIR}/logs/launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load "$PLIST_PATH"

echo "Installed launchd agent at $PLIST_PATH"
echo "Schedule: Thursday at 09:00 local time"
