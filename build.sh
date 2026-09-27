#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== Unit Test ==="
npm run test

echo ""
echo "=== Build ==="
npm run build

echo ""
echo "=== Obsidian CLI Integration Test ==="
if obsidian plugin:reload id=opds-client 2>/dev/null; then
  ./tests/obsidian-test.sh
else
  echo "Skipped: Obsidian not running (start Obsidian, then re-run for live tests)"
fi

echo ""
echo "Done."
