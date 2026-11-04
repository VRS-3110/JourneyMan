#!/bin/bash
# Installs the JourneyMan activity helper for your user. Run: bash install.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/Library/Application Support/JourneyMan"
AGENT="$HOME/Library/LaunchAgents/com.journeyman.activity.plist"
DIR="$HOME/Documents/JourneyMan/activity"

mkdir -p "$BIN" "$DIR" "$HOME/Library/LaunchAgents"
cp "$HERE/journeyman-activity.sh" "$BIN/journeyman-activity.sh"
chmod 755 "$BIN/journeyman-activity.sh"
[ -f "$DIR/config" ] || cat > "$DIR/config" <<'CFG'
# JourneyMan activity helper settings (read every 30 seconds)
TITLES=1
EXCLUDE="1Password|Keychain Access|Messages|FaceTime|Passwords"
PAUSED=0
CFG

sed "s#__SCRIPT__#$BIN/journeyman-activity.sh#; s#__LOG__#$BIN/helper.log#" "$HERE/com.journeyman.activity.plist" > "$AGENT"
launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"

echo "Installed. Recording to $DIR"
echo
echo "macOS will ask for two permissions the first time:"
echo "  1. 'osascript' wants to control 'System Events'  → Allow (needed for the app name)"
echo "  2. Accessibility for window titles: System Settings → Privacy & Security → Accessibility → add /usr/bin/osascript"
echo "     (Skip this and set TITLES=0 in $DIR/config to record app names only.)"
echo
echo "Pause any time: set PAUSED=1 in $DIR/config. Remove: bash uninstall.sh"
