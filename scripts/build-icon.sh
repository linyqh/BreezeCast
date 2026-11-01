#!/usr/bin/env bash
# Compiles src-tauri/icons/AppIcon.icon (Liquid Glass, macOS 26+) into icons/Assets.car.
# The bundler's own actool step fails with "Bad file descriptor" (tauri-apps/tauri#15315), so the .car is precompiled.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="$ROOT/src-tauri/icons"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp -R "$ICONS/AppIcon.icon" "$WORK/Icon.icon"
mkdir "$WORK/out"
xcrun actool "$WORK/Icon.icon" --compile "$WORK/out" \
  --output-format human-readable-text --notices --warnings \
  --output-partial-info-plist "$WORK/out/info.plist" \
  --app-icon Icon --include-all-app-icons --enable-on-demand-resources NO \
  --development-region en --target-device mac --minimum-deployment-target 26.0 --platform macosx </dev/null
cp "$WORK/out/Assets.car" "$ICONS/Assets.car"
echo "compiled: src-tauri/icons/Assets.car"
