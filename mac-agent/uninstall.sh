#!/bin/bash
# Stops and removes the JourneyMan activity helper. Your activity files are kept.
AGENT="$HOME/Library/LaunchAgents/com.journeyman.activity.plist"
launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
rm -f "$AGENT" "$HOME/Library/Application Support/JourneyMan/journeyman-activity.sh"
echo "Removed. Activity files are still in ~/Documents/JourneyMan/activity (delete them if you like)."
