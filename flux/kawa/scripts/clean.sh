#!/usr/bin/env bash
# Kill all Kawa and simplex-chat processes and remove test artifacts.
set -euo pipefail

echo "Killing Kawa processes..."
pkill -f "node dist/kawa.js" 2>/dev/null || true
pkill -f "simplex-chat" 2>/dev/null || true

echo "Removing temp directories..."
rm -rf /tmp/kawa-e2e-simplex
rm -rf /tmp/alice-e2e-simplex
rm -rf /tmp/kawa-simplex
rm -rf /tmp/kawa-e2e-simplex-chat
rm -rf /tmp/alice-e2e-simplex-chat

echo "Done. All Kawa processes killed and temp dirs removed."