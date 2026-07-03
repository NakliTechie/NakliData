#!/usr/bin/env bash
# guide/regenerate.sh — rebuild the NakliData field guide end to end.
#
#   1. ensure dist/ is built (the guide screenshots the production bundle)
#   2. capture — drive the app in a headless browser, screenshot every surface
#   3. build   — assemble guide/index.html from screenshots + caption data
#
# Idempotent: safe to re-run any time the app changes. Edit the caption/section
# prose in build.mjs (not index.html) and the route-plan in capture.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/index.html ]; then
  echo "[guide] dist/ missing — running npm run build"
  npm run build
fi

echo "[guide] capturing screenshots…"
node guide/capture.mjs

echo "[guide] building index.html…"
node guide/build.mjs

echo "[guide] staging into dist/guide/ (so the in-app links resolve)…"
node scripts/stage-guide.mjs

echo "[guide] done → guide/index.html (+ dist/guide/)"
