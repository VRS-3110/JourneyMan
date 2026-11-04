#!/bin/bash
# JourneyMan activity helper: records which app (and window title) you're using, once per run.
# launchd runs it every 30 seconds (see install.sh). Nothing leaves your Mac: it appends one line to
#   ~/Documents/JourneyMan/activity/YYYY-MM-DD.jsonl
# like {"t":"2026-11-04T03:30:00Z","app":"Code","title":"app.js — journeyman","idle":3}
#
# Settings live in ~/Documents/JourneyMan/activity/config:
#   TITLES=1        record window titles (0 = app names only)
#   EXCLUDE="1Password|Messages|FaceTime"   apps recorded as "Private" with no title
#   PAUSED=0        1 = record nothing

set -u
DIR="${JOURNEYMAN_ACTIVITY_DIR:-$HOME/Documents/JourneyMan/activity}"
mkdir -p "$DIR"
TITLES=1
EXCLUDE="1Password|Keychain Access|Messages|FaceTime|Passwords"
PAUSED=0
# shellcheck source=/dev/null
[ -f "$DIR/config" ] && . "$DIR/config"
[ "$PAUSED" = "1" ] && exit 0

# Seconds since the last keyboard or mouse input.
idle=$(ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ { print int($NF / 1000000000); exit }')
idle=${idle:-0}

# Screen locked or asleep: record nothing.
if ioreg -n Root -d1 -a 2>/dev/null | grep -q '<key>CGSSessionScreenIsLocked</key>'; then
  exit 0
fi

# Frontmost app and its front window's title, as one JSON line built in JavaScript for Automation.
# (The title needs Accessibility permission; without it only the app name is recorded.)
day=$(date +%Y-%m-%d)
line=$(/usr/bin/osascript -l JavaScript - "$EXCLUDE" "$TITLES" "$idle" <<'JXA' 2>/dev/null
function run(argv) {
  var exclude = new RegExp('^(' + (argv[0] || '(?!)') + ')$');
  var titles = argv[1] === '1';
  var idle = Number(argv[2]) || 0;
  var app = '', title = '';
  try {
    var p = Application('System Events').processes.whose({ frontmost: true })[0];
    app = p.name();
    if (titles) { try { title = p.windows[0].name() || ''; } catch (e) { title = ''; } }
  } catch (e) { return ''; }
  if (!app) return '';
  if (exclude.test(app)) { app = 'Private'; title = ''; }
  return JSON.stringify({ t: new Date().toISOString(), app: app, title: title, idle: idle });
}
JXA
)
[ -n "$line" ] && printf '%s\n' "$line" >> "$DIR/$day.jsonl"

# Keep 60 days.
find "$DIR" -name '*.jsonl' -mtime +60 -delete 2>/dev/null
exit 0
