#!/usr/bin/env bash
# Start Kawa and print its SimpleX connection address.
# Usage: ./scripts/start.sh [--data-dir DIR] [--port PORT] [--address-port PORT]
#
# Kawa runs under nohup so it survives the parent shell exiting.
# Logs go to /tmp/kawa.log. To stop: pkill -f 'node dist/kawa.js'
# If running interactively (terminal), Ctrl+C will stop Kawa.
set -euo pipefail
cd "$(dirname "$0")/.."

# Clean up any previous instance
pkill -f "node dist/kawa.js" 2>/dev/null || true
pkill -f "simplex-chat" 2>/dev/null || true
sleep 1

DATA_DIR=""
PORT=""
ADDR_PORT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --address-port) ADDR_PORT="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

ENV_ARGS=()
[[ -n "$DATA_DIR" ]] && ENV_ARGS+=(KAWA_SIMPLEX_DATA_DIR="$DATA_DIR")
[[ -n "$PORT" ]] && ENV_ARGS+=(KAWA_SIMPLEX_PORT="$PORT")
[[ -n "$ADDR_PORT" ]] && ENV_ARGS+=(KAWA_ADDRESS_PORT="$ADDR_PORT")

# Build if needed
if [[ ! -f dist/kawa.js ]]; then
  echo "Building..."
  npm run build
fi

LOG_FILE="/tmp/kawa.log"
echo "Starting Kawa (logs: $LOG_FILE)..."
trap 'echo ""; echo "Stopping Kawa..."; pkill -f "node dist/kawa.js" 2>/dev/null || true; pkill -f "simplex-chat" 2>/dev/null || true' SIGINT SIGTERM

if [[ ${#ENV_ARGS[@]} -gt 0 ]]; then
  nohup env "${ENV_ARGS[@]}" node dist/kawa.js >> "$LOG_FILE" 2>&1 &
else
  nohup node dist/kawa.js >> "$LOG_FILE" 2>&1 &
fi

KAWA_PID=$!
disown
echo "Kawa PID: $KAWA_PID"

# Wait for address
echo "Waiting for address API..."
for i in $(seq 1 30); do
  ADDR=$(curl -s http://localhost:${ADDR_PORT:-8080}/address 2>/dev/null || true)
  if echo "$ADDR" | grep -q "simplex"; then
    echo ""
    echo "========================================="
    echo "KAWA ADDRESS:"
    echo "$ADDR"
    echo "========================================="
    echo ""
    echo "Kawa is running (PID $KAWA_PID). Logs: $LOG_FILE"
    echo "To stop: pkill -f 'node dist/kawa.js'"
    # Keep script alive if interactive so Ctrl+C works
    if [[ -t 0 ]]; then
      wait $KAWA_PID
    fi
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for Kawa address API."
kill $KAWA_PID 2>/dev/null || true
exit 1