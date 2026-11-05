#!/bin/bash
# Packages a release build into mac/build/JourneyMan-<version>.dmg, with an Applications shortcut
# to drag the app onto. Usage: Scripts/make-dmg.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

"$ROOT/Scripts/build-app.sh" release
VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$ROOT/Resources/Info.plist")"
DMG="$ROOT/build/JourneyMan-$VERSION.dmg"

STAGING="$(mktemp -d)"
trap 'rm -rf "${STAGING:?}"' EXIT
cp -R "$ROOT/build/JourneyMan.app" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "JourneyMan $VERSION" -srcfolder "$STAGING" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
echo "Built $DMG"
