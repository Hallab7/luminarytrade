#!/usr/bin/env bash
# WASM size optimizer — resolves #259 (Reduce Contract Size)
# Runs wasm-opt -Oz on every compiled contract WASM and reports size reduction.
set -euo pipefail

TARGET_DIR="${CARGO_TARGET_DIR:-$(cd "$(dirname "$0")/.." && pwd)/target}"
WASM_DIR="$TARGET_DIR/wasm32-unknown-unknown/release"

if ! command -v wasm-opt &>/dev/null; then
  echo "wasm-opt not found — install binaryen: https://github.com/WebAssembly/binaryen"
  exit 1
fi

TOTAL_BEFORE=0
TOTAL_AFTER=0

for wasm in "$WASM_DIR"/*.wasm; do
  [[ -f "$wasm" ]] || continue
  name=$(basename "$wasm")
  before=$(wc -c < "$wasm")
  wasm-opt -Oz --strip-debug --strip-producers "$wasm" -o "$wasm"
  after=$(wc -c < "$wasm")
  pct=$(( (before - after) * 100 / before ))
  echo "$name: ${before}B -> ${after}B (-${pct}%)"
  TOTAL_BEFORE=$(( TOTAL_BEFORE + before ))
  TOTAL_AFTER=$(( TOTAL_AFTER + after ))
done

if (( TOTAL_BEFORE > 0 )); then
  TOTAL_PCT=$(( (TOTAL_BEFORE - TOTAL_AFTER) * 100 / TOTAL_BEFORE ))
  echo ""
  echo "Total: ${TOTAL_BEFORE}B -> ${TOTAL_AFTER}B (-${TOTAL_PCT}%)"
  # Acceptance criterion: at least 20% reduction
  if (( TOTAL_PCT < 20 )); then
    echo "WARNING: total size reduction ${TOTAL_PCT}% is below the 20% target"
  fi
fi
