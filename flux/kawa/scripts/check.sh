#!/usr/bin/env bash
# Run all checks: TypeScript compilation, Biome lint+format (src and tests), and build.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== TypeScript ==="
npx tsc --noEmit
echo "OK"

echo ""
echo "=== Biome src/ ==="
npx biome check src/
echo "OK"

echo ""
echo "=== Biome tests/ ==="
npx biome check tests/
echo "OK"

echo ""
echo "=== Build ==="
npm run build

echo ""
echo "All checks passed."