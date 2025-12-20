# Tracking Guardian - Protected Customer Data (PCD) Review Package

This document provides evidence and documentation for Shopify App Store review,
specifically for Protected Customer Data requirements.

---

## 1. Data Flow Diagram

### 1.1 Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CUSTOMER BROWSER                                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  1. Customer visits checkout page                                                        │
│  2. Customer completes purchase                                                          │
│  3. Web Pixel fires checkout_completed event (only event we collect!)                    │
│     - Order ID, Value, Currency, Items                                                   │
│     - Consent state (marketing: true/false, analytics: true/false)                       │
│     - NO browsing history, NO page views, NO product views                               │
└──────────────────────────────────┬──────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              TRACKING GUARDIAN SERVER                                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  4. Pixel Event Receipt (api.pixel-events.tsx)                                           │
│     - Validates Origin (Shopify domains only)                                            │
│     - Applies rate limiting                                                              │
│     - Records consent state → PixelEventReceipt table                                    │
│     - NO PII stored at this stage                                                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  5. Webhook Receipt (webhooks.tsx - orders/paid)                                         │
│     - HMAC signature verification (Shopify-signed)                                       │
│     - Extracts: order_id, total_price, currency, line_items                              │
│     - Optionally extracts PII (only if piiEnabled=true AND PCD approved):                │
│       * email → SHA256 hash → never stored                                               │
│       * phone → SHA256 hash → never stored                                               │
│     - Creates ConversionJob for async processing                                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  6. Consent Reconciliation (consent-reconciler.server.ts)                                │
│     - Matches webhook to PixelEventReceipt by orderId                                    │
│     - If no consent receipt: respects shop's consentStrategy                             │
│       * strict: don't send CAPI                                                          │
│       * balanced: don't send CAPI                                                        │
│       * weak: send CAPI (for implied consent regions only)                               │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  7. CAPI Dispatch (retry.server.ts)                                                      │
│     - Only sends if consent allows                                                       │
│     - PII is hashed in-transit, NEVER stored in our DB                                   │
│     - Sends to configured platforms only                                                 │
└──────────────────────────────────┬──────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               THIRD-PARTY AD PLATFORMS                                   │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  8. Data Sent to Platforms (if consent allows):                                          │
│                                                                                          │
│  Google GA4:                    Meta CAPI:                   TikTok Events API:          │
│  - event_name: purchase         - event_name: Purchase       - event: CompletePayment   │
│  - transaction_id               - event_id                   - event_id                  │
│  - value, currency              - value, currency            - value, currency           │
│  - items[]                      - contents[]                 - contents[]                │
│  - NO PII (Google policy)       - em, ph (SHA256 hashed)     - email, phone (SHA256)    │
│                                 - external_id (SHA256)       - external_id (SHA256)      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Storage Summary

| Data Type | Source | Storage Location | Retention | Purpose |
|-----------|--------|------------------|-----------|---------|
| Order ID | Webhook | ConversionLog, ConversionJob | Configurable (30-365 days) | Deduplication, attribution |
| Order Value | Webhook | ConversionLog | Configurable | Revenue reporting |
| Currency | Webhook | ConversionLog | Configurable | Accurate conversion value |
| Line Items | Webhook | capiInput (JSON field) | Configurable | Product-level attribution |
| Consent State | Pixel | PixelEventReceipt | Configurable | Consent verification |
| Email | Webhook | **NOT STORED** | N/A | Hashed and sent to platforms only |
| Phone | Webhook | **NOT STORED** | N/A | Hashed and sent to platforms only |

---

## 2. Data Minimization Evidence

### 2.1 What We Collect (Minimal)

From Web Pixel (checkout_completed only):
- `orderId` - Required for deduplication
- `checkoutToken` - Fallback correlation
- `value` - Conversion value
- `currency` - Currency code
- `consent.marketing` - User consent state
- `consent.analytics` - User consent state

From Webhook (orders/paid):
- `id` - Shopify order ID
- `order_number` - Display in dashboard
- `total_price` - Conversion value
- `currency` - Currency code
- `line_items[]` - Product attribution
- `checkout_token` - Correlation with pixel event

### 2.2 What We DON'T Collect

- ❌ Page views
- ❌ Product views
- ❌ Add to cart events
- ❌ Checkout started events
- ❌ Browsing history
- ❌ Device fingerprints
- ❌ IP addresses (not logged)
- ❌ Customer accounts
- ❌ Payment details

### 2.3 Code Evidence

```typescript
// extensions/tracking-pixel/src/index.ts
// ONLY checkout_completed is subscribed - other events commented out

analytics.subscribe("checkout_completed", (event) => {
  // This is the ONLY event we send to our backend
});

// page_viewed, product_viewed, etc. are NOT subscribed
```

---

## 3. Security Controls

### 3.1 Encryption at Rest

| Data | Encryption Method | Key Management |
|------|-------------------|----------------|
| Access Token | AES-256-GCM | `TOKEN_ENCRYPTION_KEY` env var |
| Ingestion Key | AES-256-GCM | `TOKEN_ENCRYPTION_KEY` env var |
| Platform Credentials | AES-256-GCM | `CREDENTIAL_ENCRYPTION_KEY` env var |
| Alert Settings | AES-256-GCM | `CREDENTIAL_ENCRYPTION_KEY` env var |

### 3.2 Encryption in Transit

- All API endpoints require HTTPS
- Webhook HMAC signature verification (Shopify-signed)
- Pixel requests validated by Origin header

### 3.3 Access Control

- OAuth 2.0 for merchant authentication
- Session-based API access (Shopify App Bridge)
- No public API endpoints for customer data

### 3.4 Audit Logging

All sensitive operations are logged in `AuditLog` table:
- Token updates
- Configuration changes
- GDPR data requests
- Data deletion events

---

## 4. Data Retention Policy

### 4.1 Configurable Retention

Merchants can configure retention period (30-365 days) via Settings page.

Default: 90 days

### 4.2 Automatic Cleanup

Cron job (`api.cron.tsx`) runs daily to delete data older than retention period:
- ConversionLog
- ConversionJob (status = processed or dead_letter)
- PixelEventReceipt
- ScanReport
- ReconciliationReport

### 4.3 GDPR Deletion

Shopify compliance webhooks trigger immediate deletion:

| Webhook | Action | Scope |
|---------|--------|-------|
| `customers/data_request` | Export customer data | Orders specified in payload |
| `customers/redact` | Delete customer data | Orders specified in payload |
| `shop/redact` | Delete ALL shop data | Complete purge of shop data |

---

## 5. GDPR/DSAR Compliance

### 5.1 Data Subject Access Request (DSAR)

When Shopify sends `customers/data_request`:
1. We queue the job in `GDPRJob` table
2. Cron processes within 30 days
3. Export includes: ConversionLog, PixelEventReceipt, SurveyResponse
4. No PII to export (we don't store it)

### 5.2 Right to Erasure

When Shopify sends `customers/redact`:
1. We queue the job in `GDPRJob` table
2. Delete all records for specified order IDs
3. Tables affected: ConversionLog, ConversionJob, PixelEventReceipt

### 5.3 Shop Uninstall

When `shop/redact` is received (mandatory 48h after uninstall):
1. Delete ALL data for the shop
2. Sessions, Configs, Logs, Reports - everything
3. No data retention after uninstall

---

## 6. Consent Management

### 6.1 Consent Signal Flow

```
Customer consents → Shopify Privacy API → Web Pixel reads state → 
Pixel event includes consent → Server respects consent for CAPI
```

### 6.2 Consent Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `strict` | Require explicit consent | GDPR regions (EU) |
| `balanced` | Use consent if available | Default for most merchants |
| `weak` | Implied consent | Non-GDPR regions only |

### 6.3 Platform-Specific Consent

| Platform | Consent Type Required | PII Allowed |
|----------|----------------------|-------------|
| Google GA4 | analytics | No PII (Google policy) |
| Meta CAPI | marketing | Hashed only |
| TikTok Events | marketing | Hashed only |

---

## 7. Review Checklist for Shopify

### Pre-Submission
- [x] All scopes have code call sites documented
- [x] Privacy disclosure matches actual data collection
- [x] GDPR webhooks implemented and tested
- [x] Data retention configurable and enforced

### PCD-Specific
- [x] PII is NEVER stored in plaintext
- [x] PII is hashed before transmission to ad platforms
- [x] Consent is verified before PII processing
- [x] Audit logging for all PII access

### Documentation
- [x] COMPLIANCE.md updated
- [x] Data flow diagram provided
- [x] Retention policy documented
- [x] GDPR handling documented

---

## 8. Testing Evidence

### 8.1 Consent Gating Test

```bash
# Test: Pixel event with consent=false should not trigger CAPI
# Expected: ConversionLog shows serverSideSent=false
```

### 8.2 GDPR Deletion Test

```bash
# Test: Send customers/redact webhook
# Expected: All related records deleted within processing window
```

### 8.3 Retention Cleanup Test

```bash
# Test: Set retention to 1 day, create old record
# Expected: Record deleted by next cron run
```

---

*Document Version: 1.0*
*Last Updated: 2024-12*
*For Shopify App Store Review*

