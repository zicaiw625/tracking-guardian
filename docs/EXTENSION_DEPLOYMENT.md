# Extension Deployment Guide

## P0-01: Backend URL Configuration (App Store Compliance)

### Overview

Shopify extensions (Web Pixel, Checkout UI) need to know the backend URL to send data. This URL is **hardcoded at build time** and **NOT merchant-configurable** for security and App Store compliance:

1. **App Store Compliance (P0-01)**: No merchant-configurable `backend_url` setting
2. **Data Exfiltration Prevention**: Events can only be sent to our controlled backend
3. **Security**: No settings exposed that could redirect customer data
4. **Simplicity**: No runtime configuration needed

### P0-01 Compliance Checklist

- ✅ No `backend_url` field in TOML settings files
- ✅ Extensions import `BACKEND_URL` from shared config (hardcoded)
- ✅ CI script validates no `backend_url` in settings

### URL Locations

The backend URL is defined in the shared config and imported by extensions:

| File | Purpose |
|------|---------|
| `extensions/shared/config.ts` | **Single source of truth** for `BACKEND_URL` |
| `extensions/tracking-pixel/src/index.ts` | Imports from shared config |
| `extensions/thank-you-blocks/src/Survey.tsx` | Imports from shared config |
| `extensions/thank-you-blocks/src/Survey.orderStatus.tsx` | Imports from shared config |

### Deployment Workflow

#### Production Deployment

```bash
# 1. Run CI validation script
./scripts/check-extension-urls.sh

# This checks:
# - No backend_url in TOML files (P0-01 compliance)
# - BACKEND_URL constant is correct in shared config
# - Extensions don't use settings.backend_url

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

The `scripts/check-extension-urls.sh` script validates P0-01 compliance:

```bash
# Run in CI pipeline
./scripts/check-extension-urls.sh

# For staging deployments
./scripts/check-extension-urls.sh staging
```

The script performs these checks:
1. **No backend_url in TOML**: Ensures no merchant-configurable settings
2. **Correct BACKEND_URL**: Verifies the shared config has the expected URL
3. **No settings.backend_url usage**: Extensions don't read from settings

### Allowed Domains

Only these domains are allowed (see `extensions/shared/config.ts`):

- `tracking-guardian.onrender.com` (production)
- `tracking-guardian-staging.onrender.com` (staging)
- `localhost` (development only)
- `127.0.0.1` (development only)

### Troubleshooting

**Q: Extensions are sending data to the wrong URL**
A: Check that the correct extension version is deployed. Each environment needs its own build with the correct `BACKEND_URL` in `extensions/shared/config.ts`.

**Q: Can merchants configure the URL?**
A: No, by design. This is a P0-01 App Store compliance requirement. The `backend_url` setting was removed from TOML files.

**Q: How do I test with a custom backend?**
A: Use staging deployment with a separate Shopify app, or run the app locally with `shopify app dev` (pixel events still go to production URL, but you can filter them server-side by checking the shop domain).

**Q: What if App Store review asks about data destinations?**
A: The backend URL is hardcoded and not merchant-configurable. Events are only sent to our controlled backend (`tracking-guardian.onrender.com`). This is verified by CI checks.

