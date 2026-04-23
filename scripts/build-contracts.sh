#!/usr/bin/env bash
# Parallel Soroban contract builder — resolves #258 (Improve Contract Compilation Time)
# Builds all contracts concurrently and reports per-contract and total wall-clock time.
set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "$0")/../contracts" && pwd)"
JOBS=()
PIDS=()
START_TIMES=()
NAMES=()

build_contract() {
  local name="$1"
  local dir="$2"
  local start end elapsed
  start=$(date +%s%N)
  cargo build --release --manifest-path "$dir/Cargo.toml" --target wasm32-unknown-unknown \
    2>&1 | sed "s/^/[$name] /"
  end=$(date +%s%N)
  elapsed=$(( (end - start) / 1000000 ))
  echo "[$name] built in ${elapsed}ms"
}

export -f build_contract

echo "==> Building all contracts in parallel..."
TOTAL_START=$(date +%s%N)

for dir in "$CONTRACTS_DIR"/*/; do
  [[ -f "$dir/Cargo.toml" ]] || continue
  name=$(basename "$dir")
  build_contract "$name" "$dir" &
  PIDS+=($!)
  NAMES+=("$name")
done

FAILED=0
for i in "${!PIDS[@]}"; do
  if ! wait "${PIDS[$i]}"; then
    echo "[ERROR] ${NAMES[$i]} failed"
    FAILED=1
  fi
done

TOTAL_END=$(date +%s%N)
TOTAL_MS=$(( (TOTAL_END - TOTAL_START) / 1000000 ))
echo ""
echo "==> All contracts built in ${TOTAL_MS}ms (wall clock)"

# CI gate: fail if total build time exceeds 30 000 ms (30 s)
MAX_MS=${MAX_BUILD_MS:-30000}
if (( TOTAL_MS > MAX_MS )); then
  echo "ERROR: build time ${TOTAL_MS}ms exceeds limit ${MAX_MS}ms" >&2
  exit 1
fi

exit $FAILED
