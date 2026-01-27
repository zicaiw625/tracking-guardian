#!/bin/bash

set -e

PRODUCTION_URL="https://tracking-guardian.onrender.com"
STAGING_URL="https://tracking-guardian-staging.onrender.com"

if [ "$1" == "staging" ]; then
  EXPECTED_URL="$STAGING_URL"
  echo "Checking for staging URL: $EXPECTED_URL"
else
  EXPECTED_URL="$PRODUCTION_URL"
  echo "Checking for production URL: $EXPECTED_URL"
fi

ERRORS=0

echo ""
echo "======================================"
echo "Checking for backend_url in TOML files (must be 0 matches)"
echo "======================================"

TOML_FILES=(
  "extensions/tracking-pixel/shopify.extension.toml"
)

for file in "${TOML_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "WARNING: $file not found, skipping"
    continue
  fi

  if grep -q "backend_url" "$file"; then
    echo "❌ $file: Found 'backend_url' - this should be removed!"
    ERRORS=$((ERRORS + 1))
  else
    echo "✅ $file: No backend_url found (correct)"
  fi
done

echo ""
echo "======================================"
echo "Checking BACKEND_URL constant in source files"
echo "======================================"

SOURCE_FILES=(
  "extensions/shared/config.ts"
)

for file in "${SOURCE_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "WARNING: $file not found, skipping"
    continue
  fi

  if grep -q "BACKEND_URL = \"$EXPECTED_URL\"" "$file"; then
    echo "✅ $file: OK"
  else
    ACTUAL=$(grep -o 'BACKEND_URL = "[^"]*"' "$file" | head -1 || echo "not found")
    echo "❌ $file: Expected '$EXPECTED_URL' but found $ACTUAL"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""
echo "======================================"
echo "Checking that extensions use shared config (not settings.backend_url)"
echo "======================================"

EXTENSION_FILES=(
  "extensions/tracking-pixel/src/index.ts"
)

for file in "${EXTENSION_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "WARNING: $file not found, skipping"
    continue
  fi

  if grep -v "^\s*//" "$file" | grep -v "// P0" | grep -q "settings\.backend_url\|settings\[.backend_url.\]"; then
    echo "❌ $file: Still uses settings.backend_url - should use shared config!"
    ERRORS=$((ERRORS + 1))
  else
    echo "✅ $file: Does not use settings.backend_url (correct)"
  fi
done

echo ""

if [ $ERRORS -gt 0 ]; then
  echo "======================================"
  echo "FAILED: Found $ERRORS issue(s)"
  echo "======================================"
  echo ""
  echo "To fix:"
  echo "1. Remove any 'backend_url' settings from TOML files"
  echo "2. Update extensions to import BACKEND_URL from shared/config.ts"
  echo "3. Ensure shared/config.ts has the correct BACKEND_URL for your environment"
  echo ""
  echo "See docs/EXTENSION_DEPLOYMENT.md for details."
  exit 1
fi

echo "======================================"
echo "SUCCESS: All extension checks passed for ${1:-production}"
echo "======================================"
exit 0
