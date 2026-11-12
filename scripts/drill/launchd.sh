#!/usr/bin/env bash
# The daily drill as a macOS launchd job on this machine (it runs only while the machine is awake). The
# published drill runs on GitHub Actions (.github/workflows/drill.yml); use one or the other, never both:
# two drills on one strategy race each other's transactions.
#
#   scripts/drill/launchd.sh install [HH:MM UTC]   default 14:00 UTC; the rescue window opens ~40 min later
#   scripts/drill/launchd.sh uninstall
#   scripts/drill/launchd.sh status
#
# Each run: agents/drill.py --grace $GRACE (default 3 h), so the practice strategy stays open to outside
# guardians for that long before the drill's own guardian rescues it. Output: docs/results/drill/console.log.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=com.keel.drill
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
GRACE=${GRACE:-10800}

case "${1:-}" in
  install)
    at=${2:-14:00}
    # launchd schedules in local time.
    read -r hour minute <<< "$(python3 -I -c '
import sys, datetime as d
h, m = map(int, sys.argv[1].split(":"))
t = d.datetime.now(d.timezone.utc).replace(hour=h, minute=m).astimezone()
print(t.hour, t.minute)' "$at")"
    # launchd starts jobs without the login shell's PATH: keep the installer's (cast, node, python).
    for t in cast node python3 curl; do command -v "$t" >/dev/null || { echo "missing $t on PATH" >&2; exit 1; }; done
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>-c</string>
    <string>cd '$ROOT_DIR' &amp;&amp; .tools/venv/bin/python -u agents/drill.py --grace $GRACE &gt;&gt; docs/results/drill/console.log 2&gt;&amp;1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH</string></dict>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed: daily at $at UTC ($(printf '%02d:%02d' "$hour" "$minute") local), grace ${GRACE}s"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|last exit|runs" || echo "not installed"
    ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
