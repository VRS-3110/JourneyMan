#!/bin/bash
# Builds JourneyMan.app into mac/build. Usage: Scripts/build-app.sh [debug|release] (default release)
# The app is a native window around the web app at the top of this repo (index.html, css/, js/,
# icons/), which is copied into the app. Release builds are universal (Apple silicon and Intel).
set -euo pipefail
source "$(dirname "$0")/toolchain-env.sh"
CONFIG="${1:-release}"
REPO="$(cd "$ROOT/.." && pwd)"
cd "$ROOT"

SLICES=()
if [ "$CONFIG" = release ]; then
  for ARCH in arm64 x86_64; do
    swift build -c release --arch "$ARCH" --product JourneyMan
    SLICES+=("$(swift build -c release --arch "$ARCH" --show-bin-path)/JourneyMan")
  done
else
  swift build -c "$CONFIG" --product JourneyMan
  SLICES+=("$(swift build -c "$CONFIG" --show-bin-path)/JourneyMan")
fi

APP="$ROOT/build/JourneyMan.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
if [ "${#SLICES[@]}" -gt 1 ]; then
  lipo -create "${SLICES[@]}" -output "$APP/Contents/MacOS/JourneyMan"
else
  cp "${SLICES[0]}" "$APP/Contents/MacOS/JourneyMan"
fi
cp "$ROOT/Resources/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/Resources/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp -R "$REPO/index.html" "$REPO/manifest.webmanifest" "$REPO/css" "$REPO/js" "$REPO/icons" "$APP/Contents/Resources/web/"
# Ad-hoc signature so macOS treats it as a proper app (calendar and folder prompts).
codesign --force --sign - "$APP" >/dev/null
echo "Built $APP ($CONFIG)"
