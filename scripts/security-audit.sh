#!/usr/bin/env bash
# Security audit runner — resolves #261 (Enhance Security Audits)
# Runs cargo-audit on every contract and fails if any high/critical advisories are found.
set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "$0")/../contracts" && pwd)"
FAILED=0

if ! command -v cargo-audit &>/dev/null; then
  echo "Installing cargo-audit..."
  cargo install cargo-audit --quiet
fi

for dir in "$CONTRACTS_DIR"/*/; do
  [[ -f "$dir/Cargo.toml" ]] || continue
  name=$(basename "$dir")
  echo "==> Auditing $name..."
  if ! cargo audit --file "$dir/Cargo.toml" --deny warnings 2>&1 | sed "s/^/[$name] /"; then
    echo "[ERROR] $name has vulnerable dependencies"
    FAILED=1
  fi
done

if (( FAILED )); then
  echo ""
  echo "Security audit FAILED — fix high/critical advisories before merging."
  exit 1
fi

echo ""
echo "Security audit passed — no high-risk issues found."
