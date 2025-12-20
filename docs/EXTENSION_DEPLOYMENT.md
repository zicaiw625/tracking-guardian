# Extension Deployment Guide

## P0-2: Backend URL Configuration

### Overview

Shopify extensions (Web Pixel, Checkout UI) need to know the backend URL to send data. This URL is **hardcoded at build time** (not merchant-configurable) for security reasons:

1. **App Store Compliance**: Prevents data exfiltration concerns
2. **Security**: Only trusted domains controlled by the app developer are allowed
3. **Simplicity**: No runtime configuration needed

### URL Locations

The backend URL is defined in these files:

| Extension | File | Constant |
|-----------|------|----------|
| Web Pixel | `extensions/tracking-pixel/src/index.ts` | `BACKEND_URL` |
| Survey Block | `extensions/thank-you-blocks/src/Survey.tsx` | `BACKEND_URL` |
| Shared Config | `extensions/shared/config.ts` | `BACKEND_URL` |

### Deployment Workflow

#### Production Deployment

```bash
# 1. Verify all BACKEND_URL values are set to production
grep -r "BACKEND_URL" extensions/*/src/*.ts

# Expected output should show:
# const BACKEND_URL = "https://tracking-guardian.onrender.com";

# 2. Deploy to production
shopify app deploy
```

#### Staging Deployment

For staging, you need to build extensions with a different URL:

```bash
# Option 1: Manually update files before deploy
# Edit extensions/tracking-pixel/src/index.ts
# Edit extensions/thank-you-blocks/src/Survey.tsx
# Change BACKEND_URL to "https://tracking-guardian-staging.onrender.com"

# Then deploy
shopify app deploy

# IMPORTANT: Revert changes after staging deploy!
```

#### Local Development

For local development, the extensions still use the production URL by default. This is intentional:

- Pixel events in dev mode will go to production (can be filtered server-side)
- Or use a separate staging deployment for testing

### CI/CD Validation

Add this check to your CI pipeline:

```bash
# scripts/check-extension-urls.sh
#!/bin/bash

EXPECTED_URL="https://tracking-guardian.onrender.com"

# Check all extension files
FILES=(
  "extensions/tracking-pixel/src/index.ts"
  "extensions/thank-you-blocks/src/Survey.tsx"
)

ERRORS=0
for file in "${FILES[@]}"; do
  if ! grep -q "BACKEND_URL = \"$EXPECTED_URL\"" "$file"; then
    echo "ERROR: $file does not have correct BACKEND_URL"
    ERRORS=$((ERRORS + 1))
  fi
done

if [ $ERRORS -gt 0 ]; then
  echo "Found $ERRORS files with incorrect BACKEND_URL"
  exit 1
fi

echo "All extension URLs are correctly configured"
exit 0
```

### Allowed Domains

Only these domains are allowed (see `extensions/shared/config.ts`):

- `tracking-guardian.onrender.com` (production)
- `tracking-guardian-staging.onrender.com` (staging)
- `localhost` (development only)
- `127.0.0.1` (development only)

### Troubleshooting

**Q: Extensions are sending data to the wrong URL**
A: Check that the correct extension version is deployed. Each environment needs its own build.

**Q: Can merchants configure the URL?**
A: No, by design. This is a security measure for App Store compliance.

**Q: How do I test with a custom backend?**
A: Use staging deployment, or run the app locally with `shopify app dev` (pixel events still go to production URL, but you can filter them server-side by checking the origin).

