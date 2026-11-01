#!/usr/bin/env bash
# Builds the macOS .dmg locally and uploads it to GitHub Release v<version>, the same release
# the Windows CI job (.github/workflows/release-windows.yml) uploads its installer to.
#   scripts/release-macos.sh [--skip-build] [--publish]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_BUILD=0
PUBLISH=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --publish) PUBLISH=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
TAG="v$VERSION"

if ! git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null; then
  echo "tag $TAG is not on origin; run: git tag $TAG && git push origin $TAG" >&2
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$TAG^{commit}" 2>/dev/null)" ] || [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "warning: working tree differs from $TAG; the uploaded dmg will not match the tagged source" >&2
fi

if [ "$SKIP_BUILD" = 0 ]; then
  TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
  [ -x "src-tauri/binaries/audiocpp_server-$TRIPLE" ] || scripts/build-engine.sh
  pnpm tauri build
fi

shopt -s nullglob
DMGS=(src-tauri/target/release/bundle/dmg/BreezeCast_"$VERSION"_*.dmg)
if [ ${#DMGS[@]} -eq 0 ]; then
  echo "no dmg for $VERSION under src-tauri/target/release/bundle/dmg/" >&2
  exit 1
fi

if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --draft --verify-tag --title "BreezeCast $TAG" --generate-notes \
    || gh release view "$TAG" >/dev/null
fi
gh release upload "$TAG" "${DMGS[@]}" --clobber
if [ "$PUBLISH" = 1 ]; then
  gh release edit "$TAG" --draft=false
fi
gh release view "$TAG" --json url,isDraft,assets -q '"\(.url) draft=\(.isDraft)\n" + ([.assets[].name] | join("\n"))'
