# Shopify API Version Upgrade SOP

## Overview

This document outlines the Standard Operating Procedure for managing Shopify API versions in Tracking Guardian. Following this process ensures the app remains compatible with Shopify's API lifecycle and avoids production outages.

---

## Current API Versions

| Component | Version | File Location | Update Frequency |
|-----------|---------|---------------|------------------|
| Admin API | `2025-07` | `app/shopify.server.ts` | Quarterly |
| Web Pixel Extension | `2025-07` | `extensions/tracking-pixel/shopify.extension.toml` | Quarterly |

---

## Shopify API Lifecycle

Shopify releases new API versions quarterly:
- **January** (e.g., 2025-01)
- **April** (e.g., 2025-04)
- **July** (e.g., 2025-07)
- **October** (e.g., 2025-10)

Each version is supported for approximately **12 months** after release.

### Example Timeline for 2025-07
- **Release:** July 2025
- **Deprecation warning:** January 2026
- **End of support:** ~October 2026

---

## Upgrade Schedule

### Recommended Upgrade Window

| When to Check | Action |
|---------------|--------|
| 30 days after new version release | Review changelog, assess breaking changes |
| 60 days after new version release | Start development/testing on new version |
| 90 days after new version release | Deploy to production |
| 6 months before EOL | **Must** upgrade if not already done |

### Quarterly Review Checklist

- [ ] Check [Shopify API Changelog](https://shopify.dev/changelog)
- [ ] Review breaking changes in the new version
- [ ] Test all GraphQL queries with new version
- [ ] Update `app/shopify.server.ts` ApiVersion
- [ ] Update `extensions/tracking-pixel/shopify.extension.toml` api_version
- [ ] Run full test suite
- [ ] Deploy to staging environment
- [ ] Monitor for errors for 24-48 hours
- [ ] Deploy to production

---

## Step-by-Step Upgrade Process

### Step 1: Review Changelog

1. Visit [Shopify API Changelog](https://shopify.dev/changelog)
2. Filter by "Admin API" and your target version
3. Note any breaking changes that affect:
   - `webPixels` queries
   - `scriptTags` queries
   - `orders` webhook payloads
   - OAuth scopes

### Step 2: Update Server-Side API Version

Edit `app/shopify.server.ts`:

```typescript
// Before
import { ApiVersion } from "@shopify/shopify-api";
// ...
apiVersion: ApiVersion.July25,

// After
import { ApiVersion } from "@shopify/shopify-api";
// ...
apiVersion: ApiVersion.October25, // or the new version
```

### Step 3: Update Pixel Extension Version

Edit `extensions/tracking-pixel/shopify.extension.toml`:

```toml
# Before
api_version = "2025-07"

# After
api_version = "2025-10"
```

### Step 4: Test GraphQL Queries

Run the following tests to ensure compatibility:

```bash
# Run unit tests
npm run test

# Test specific API queries
npm run test -- tests/services/scanner.test.ts
npm run test -- tests/webhooks/gdpr.test.ts
```

### Step 5: Deploy to Staging

```bash
# Deploy app to staging
git push staging main

# Deploy extensions
shopify app deploy --reset
```

### Step 6: Verify in Staging

1. Install app on a development store
2. Verify pixel events are received
3. Verify webhook processing works
4. Check for any console errors

### Step 7: Deploy to Production

```bash
# Deploy to production
git push production main

# Monitor logs
render logs --tail
```

---

## Common Breaking Changes to Watch

### WebPixels API
- Changes to `webPixelCreate` mutation input
- Changes to `webPixels` query response shape
- New required settings fields

### ScriptTags API
- Deprecation warnings for ScriptTag queries
- Changes to GraphQL node IDs format

### Webhooks
- Changes to `orders/paid` payload structure
- New required fields
- Changes to authentication headers

### OAuth
- New scope requirements
- Changes to access token format

---

## Rollback Procedure

If issues are discovered after deployment:

### Immediate Rollback (< 24 hours)

1. Revert the API version changes:
   ```bash
   git revert HEAD
   git push production main
   ```

2. Redeploy extensions:
   ```bash
   shopify app deploy --reset
   ```

### Long-term Fix

1. Create a hotfix branch
2. Identify and fix the compatibility issue
3. Add regression tests
4. Follow normal deployment process

---

## Monitoring

### Key Metrics to Watch Post-Upgrade

| Metric | Normal Range | Alert Threshold |
|--------|--------------|-----------------|
| Pixel event ingestion rate | Baseline ±10% | >20% drop |
| Webhook processing success rate | >99% | <95% |
| GraphQL error rate | <1% | >5% |
| API latency | <500ms p99 | >1000ms |

### Log Queries

```bash
# Check for API version errors
grep -i "api version" logs/app.log

# Check for GraphQL errors
grep -i "graphql" logs/app.log | grep -i "error"
```

---

## Version History

| Date | From Version | To Version | Notes |
|------|--------------|------------|-------|
| 2024-12 | 2024-10 | 2025-07 | Initial upgrade to stable version |

---

## Resources

- [Shopify API Versioning](https://shopify.dev/docs/api/usage/versioning)
- [API Changelog](https://shopify.dev/changelog)
- [GraphQL Admin API Reference](https://shopify.dev/docs/api/admin-graphql)
- [Web Pixels API Reference](https://shopify.dev/docs/api/admin-graphql/latest/objects/WebPixel)

---

## Deprecation Schedules

### Pixel Events Timestamp Header

The `X-Tracking-Guardian-Timestamp` header is being made mandatory for pixel events.

| Phase | Timeline | Behavior |
|-------|----------|----------|
| v1.1.0 (current) | Now | Timestamp optional, warning logged for missing |
| v1.2.0 | Q2 2025 | Required for new shop installations |
| v1.3.0 | Q3 2025 | Required for all shops, requests rejected without timestamp |

**Merchant Impact:** Shops using old Web Pixel versions will need to reinstall/update the pixel before Q3 2025 to avoid service interruption.

### Ingestion Key Field Naming

The `ingestion_secret` field is being renamed to `ingestion_key` for clarity.

| Phase | Status | Behavior |
|-------|--------|----------|
| Current | Active | Both `ingestion_key` and `ingestion_secret` are accepted |
| Future | Planned | `ingestion_secret` will be deprecated (reading still supported) |

**No action required:** The pixel code reads both field names automatically.

---

*Last Updated: December 2024*

