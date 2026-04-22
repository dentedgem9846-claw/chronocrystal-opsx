#!/usr/bin/env bash
# Stop any running Kawa and simplex-chat processes.
set -euo pipefail

echo "Stopping Kawa..."
pkill -f "node dist/kawa.js" 2>/dev/null && echo "Kawa stopped." || echo "No Kawa process found."
pkill -f "simplex-chat" 2>/dev/null && echo "simplex-chat stopped." || echo "No simplex-chat process found."