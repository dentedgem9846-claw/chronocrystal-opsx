#!/usr/bin/env bash
# Run all checks: TypeScript type check, Biome autofix (lint+format), and build.
# Always fixes — never just reports.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== TypeScript ==="
npx tsc --noEmit
echo "OK"

echo ""
echo "=== Biome lint + format (autofix) ==="
npx biome check --write src/ tests/
echo "OK"

echo ""
echo "=== Build ==="
npm run build

echo ""
echo "All checks passed."