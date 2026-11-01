#!/usr/bin/env bash
# Symlink skills/breezecast into each existing agent skills directory.
# Usage: scripts/install-skills.sh [--uninstall]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SKILL_SRC="$REPO_ROOT/skills/breezecast"
NAME="breezecast"

uninstall=0
case "${1:-}" in
  "") ;;
  --uninstall) uninstall=1 ;;
  -h|--help) echo "Usage: $0 [--uninstall]"; exit 0 ;;
  *) echo "Unknown argument: $1" >&2; exit 2 ;;
esac

if [ ! -f "$SKILL_SRC/SKILL.md" ]; then
  echo "Skill not found at $SKILL_SRC" >&2
  exit 1
fi

if [ "$uninstall" -eq 0 ] && [ -d "$HOME/.claude" ] && [ ! -d "$HOME/.claude/skills" ]; then
  mkdir -p "$HOME/.claude/skills"
fi

for dir in "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.omp/agent/skills"; do
  [ -d "$dir" ] || continue
  target="$dir/$NAME"

  if [ "$uninstall" -eq 1 ]; then
    if [ -L "$target" ] && [ "$(readlink "$target")" = "$SKILL_SRC" ]; then
      rm "$target"
      echo "removed  $target"
    elif [ -e "$target" ] || [ -L "$target" ]; then
      echo "skipped  $target (not a symlink to this repo)"
    fi
    continue
  fi

  if [ -L "$target" ]; then
    if [ "$(readlink "$target")" = "$SKILL_SRC" ]; then
      echo "ok       $target (already linked)"
      continue
    fi
    echo "skipped  $target (symlink points elsewhere: $(readlink "$target"))" >&2
    continue
  fi
  if [ -e "$target" ]; then
    echo "skipped  $target (exists and is not a symlink)" >&2
    continue
  fi
  ln -s "$SKILL_SRC" "$target"
  echo "linked   $target -> $SKILL_SRC"
done
