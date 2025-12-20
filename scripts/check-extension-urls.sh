#!/bin/bash
#
# P0-2: CI/CD validation script for extension backend URLs
#
# Usage:
#   ./scripts/check-extension-urls.sh              # Check production URL
#   ./scripts/check-extension-urls.sh staging      # Check staging URL
#
# Exit codes:
#   0 - All URLs match expected value
#   1 - One or more URLs do not match

set -e

PRODUCTION_URL="https://tracking-guardian.onrender.com"
STAGING_URL="https://tracking-guardian-staging.onrender.com"

# Determine which URL to check
if [ "$1" == "staging" ]; then
  EXPECTED_URL="$STAGING_URL"
  echo "Checking for staging URL: $EXPECTED_URL"
else
  EXPECTED_URL="$PRODUCTION_URL"
  echo "Checking for production URL: $EXPECTED_URL"
fi

# Files to check
FILES=(
  "extensions/tracking-pixel/src/index.ts"
  "extensions/thank-you-blocks/src/Survey.tsx"
)

ERRORS=0

for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "WARNING: $file not found, skipping"
    continue
  fi
  
  # Check if the file contains the expected URL
  if grep -q "BACKEND_URL = \"$EXPECTED_URL\"" "$file"; then
    echo "✅ $file: OK"
  else
    # Show what URL is actually set
    ACTUAL=$(grep -o 'BACKEND_URL = "[^"]*"' "$file" | head -1 || echo "not found")
    echo "❌ $file: Expected '$EXPECTED_URL' but found $ACTUAL"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""

if [ $ERRORS -gt 0 ]; then
  echo "FAILED: Found $ERRORS file(s) with incorrect BACKEND_URL"
  echo ""
  echo "To fix, update the BACKEND_URL constant in the listed files."
  echo "See docs/EXTENSION_DEPLOYMENT.md for details."
  exit 1
fi

echo "SUCCESS: All extension URLs are correctly configured for ${1:-production}"
exit 0

