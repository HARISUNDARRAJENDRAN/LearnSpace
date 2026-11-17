#!/usr/bin/env bash
# Renders every cue in sfx.txt to assets/sfx/<file>.wav with earshot (https://github.com/Leonxlnx/earshot).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/sfx
grep -v '^#' scripts/sfx.txt | while read -r file sound args; do
  [ -n "$file" ] || continue
  # shellcheck disable=SC2086
  earshot sfx render "$sound" -o "assets/sfx/$file.wav" --sr 48000 $args </dev/null >/dev/null
  echo "$file"
done
