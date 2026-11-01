#!/usr/bin/env bash
# Builds the audio.cpp server (Metal, BreezeTTS only) and installs it as the Tauri sidecar.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/audio.cpp"
TOOLS="$ROOT/.tools"

if [ ! -d "$VENDOR" ]; then
  REV="$(tr -d '[:space:]' < "$ROOT/scripts/audiocpp.rev")"
  git init -q "$VENDOR"
  git -C "$VENDOR" remote add origin https://github.com/0xShug0/audio.cpp.git
  git -C "$VENDOR" fetch -q --depth 1 origin "$REV"
  git -C "$VENDOR" checkout -q FETCH_HEAD
  git -C "$VENDOR" submodule update -q --init --recursive --depth 1
fi
if ! command -v cmake >/dev/null 2>&1; then
  [ -x "$TOOLS/bin/cmake" ] || { python3 -m venv "$TOOLS" && "$TOOLS/bin/pip" install -q cmake ninja; }
  export PATH="$TOOLS/bin:$PATH"
fi

cd "$VENDOR"
scripts/build_metal.sh --build-type Release --archs arm64 --model-set custom --models breeze_tts \
  --deployment-build --target audiocpp_server

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
mkdir -p "$ROOT/src-tauri/binaries"
cp build/macos-metal-release/bin/audiocpp_server "$ROOT/src-tauri/binaries/audiocpp_server-$TRIPLE"
echo "sidecar installed: src-tauri/binaries/audiocpp_server-$TRIPLE"
