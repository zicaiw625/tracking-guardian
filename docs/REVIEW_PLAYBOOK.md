# Tracking Guardian - App Store Review Playbook

This document provides step-by-step testing procedures for Shopify App Store review.

---

## 0. App Overview & Positioning

### What is Tracking Guardian?

Tracking Guardian is a **Checkout Extensibility Migration Tool** that helps merchants:

1. **Migrate from legacy tracking scripts** (ScriptTags, Additional Scripts) to **Web Pixel + Server-side CAPI**
2. **Maintain conversion tracking** during Shopify's deprecation of checkout.liquid and additional scripts
3. **Improve tracking accuracy** by combining client-side Web Pixel with server-side Conversions API

### Why does this app include Checkout UI Blocks?

The app includes **Checkout UI Extension blocks** (Survey, Shipping Tracker, Upsell) because:

- **These replace functionality previously achieved via Additional Scripts**: Merchants historically added post-purchase surveys, shipping trackers, and upsell offers through checkout.liquid additional scripts
- **Shopify's official migration path**: Shopify recommends using Checkout UI Extensions to replace custom checkout modifications (see [Shopify Checkout Extensibility](https://shopify.dev/docs/apps/checkout))
- **Complete migration solution**: By including these blocks, merchants can fully migrate away from legacy checkout customizations

**Important for Reviewers**: These blocks are **NOT** separate products - they are part of a unified migration solution. The app's value proposition is "migrate everything from your old checkout scripts to the new Checkout Extensibility platform in one place."

### Core Features Summary

| Feature | Technology | Purpose |
|---------|------------|---------|
| Conversion Tracking | Web Pixel + CAPI | Replace legacy tracking scripts |
| Survey Block | Checkout UI Extension | Replace additional scripts survey |
| Shipping Tracker | Checkout UI Extension | Replace additional scripts tracking |
| Upsell Offers | Checkout UI Extension | Replace additional scripts upsells |
| Migration Scanner | Admin App | Identify scripts needing migration |

### Privacy-First Design

- **Default**: PII is NOT sent to ad platforms (privacy-first mode)
- **Optional**: Enhanced matching (PII) requires explicit merchant acknowledgment of their own compliance obligations
- **Note**: The app developer has already completed Shopify PCD review - merchants do NOT need to do PCD review themselves
- **Consent**: Strict consent strategy by default - events only sent with explicit user consent

---

## ⭐ KEY POINT: PII is COMPLETELY OPTIONAL

### This app works perfectly WITHOUT PII

**The core conversion tracking functionality sends only:**
- Order ID, value, currency
- Product SKU and quantity (for attribution)
- Consent status evidence

**What we DON'T send by default:**
- ❌ Customer email
- ❌ Customer phone
- ❌ Customer address
- ❌ Any personal identifiers

### Why offer Enhanced Matching (PII) at all?

Enhanced matching (PII) is an **opt-in feature** for merchants who:
1. Have been explicitly advised by their ad platform to enable enhanced matching
2. Have updated their privacy policy to reflect PII usage
3. Understand their own compliance obligations under GDPR/CCPA/PIPL

**Important**: The app developer has already completed Shopify's Protected Customer Data (PCD) review. Merchants do NOT need to go through PCD review themselves - they only need to ensure their own store policies are compliant.

### PII Enabling Flow (Strong Guardrails)

When a merchant tries to enable PII, they see:
1. **Detailed confirmation dialog** explaining all responsibilities
2. **Explicit acknowledgment** of their compliance obligations (privacy policy, regional laws)
3. **Information banner** reminding them of data handling practices
4. **Recommendation to disable** if they're not sure they need it

**Note**: The app developer has completed PCD review. Merchants confirm their OWN compliance (privacy policy, GDPR/CCPA), not Shopify's PCD process.

### For Reviewers: How to Test Both Modes

| Mode | How to Test | What to Verify |
|------|-------------|----------------|
| **Privacy-First (Default)** | Install app, don't change settings | PII fields are empty in CAPI payloads |
| **Enhanced Matching (Opt-in)** | Go to Settings → Security → Enable PII | Confirmation dialog appears, PCD banner shows |

**Note**: Most merchants should NOT enable PII. The app actively discourages enabling it unless truly needed.

---

## 1. Installation & Setup (5 minutes)

### 1.1 Install App
```bash
# From App Store
1. Navigate to app listing
2. Click "Add app"
3. Complete OAuth authorization
4. Verify redirect to app dashboard
```

### 1.2 Verify Initial State
```bash
# In App Dashboard
1. Navigate to Home page
2. Verify no error banners
3. Navigate to Settings → Security tab
4. Verify Ingestion Key shows "已配置" (Configured) with green badge
```

**Expected Result**: App installs without errors, ingestion key is auto-generated.

---

## 2. Web Pixel Verification (3 minutes)

### 2.1 Install Web Pixel
```bash
# In App Dashboard
1. Navigate to "迁移" (Migrate) page
2. Select any platform (e.g., Google Analytics 4)
3. Enter a test measurement ID (e.g., G-XXXXXXX)
4. Click "生成并启用像素" (Generate and Enable Pixel)
5. Verify success message
```

### 2.2 Verify in Shopify Admin
```bash
# In Shopify Admin
1. Go to Settings → Customer events
2. Verify "Tracking Guardian Pixel" is listed
3. Click to view settings
4. Verify ONLY "Ingestion Key" setting is visible (auto-generated during install)
5. NO "Backend URL" setting exists (hardcoded for security - P0-01 compliance)
```

**Expected Result**: Pixel is installed with minimal settings (ingestion_key only).

---

## 3. Consent Gating Verification (5 minutes)

### 3.1 Test with Consent Denied

```bash
# In Browser DevTools (Network tab)
1. Open store checkout page
2. If consent banner appears, click "Deny All" or equivalent
3. Complete a test purchase
4. Monitor Network tab for requests to /api/pixel-events

# Expected: NO requests to /api/pixel-events when consent denied
```

### 3.2 Test with Consent Accepted

```bash
# In Browser DevTools (Network tab)
1. Open store checkout page in new incognito window
2. If consent banner appears, click "Accept All"
3. Complete a test purchase
4. Monitor Network tab for request to /api/pixel-events

# Expected: 
# - POST to /api/pixel-events
# - Request body contains: eventName="checkout_completed"
# - Request body contains: consent.marketing=true or consent.analytics=true
# - NO page_viewed, product_viewed events (P0-02 compliance)
```

**Verification Code**:
```javascript
// In browser console, check network requests
const events = performance.getEntriesByType('resource')
  .filter(r => r.name.includes('pixel-events'));
console.log('Pixel events sent:', events.length);
```

---

## 4. Event Filtering Verification (3 minutes)

### 4.1 Verify Only checkout_completed Sent

```bash
# Using browser DevTools Network tab
1. Browse store: view home page, product pages, add to cart
2. Monitor for /api/pixel-events requests

# Expected: NO requests until checkout is COMPLETED
# - page_viewed: NOT sent
# - product_viewed: NOT sent  
# - product_added_to_cart: NOT sent
# - checkout_started: NOT sent
# - payment_info_submitted: NOT sent
# - checkout_completed: SENT (only this one)
```

This confirms P0-02 compliance: "What We DON'T Collect: Customer browsing history"

---

## 5. GDPR Webhook Testing (5 minutes)

### 5.1 customers/data_request

```bash
# Using Shopify CLI or Partner Dashboard
shopify app webhook trigger customers/data_request --address YOUR_APP_URL/webhooks

# Payload example:
{
  "shop_domain": "test-store.myshopify.com",
  "orders_requested": ["12345", "12346"]
}

# Expected: HTTP 200 response, GDPRJob created with status "queued"
```

### 5.2 customers/redact

```bash
shopify app webhook trigger customers/redact --address YOUR_APP_URL/webhooks

# Payload example:
{
  "shop_domain": "test-store.myshopify.com",
  "orders_to_redact": ["12345"]
}

# Expected: HTTP 200 response, GDPRJob created, related ConversionLog deleted
```

### 5.3 shop/redact

```bash
shopify app webhook trigger shop/redact --address YOUR_APP_URL/webhooks

# Payload example:
{
  "shop_domain": "test-store.myshopify.com"
}

# Expected: HTTP 200 response, ALL shop data queued for deletion
```

---

## 6. APP_UNINSTALLED Verification (3 minutes)

### 6.1 Uninstall App

```bash
# In Shopify Admin
1. Go to Settings → Apps and sales channels
2. Click on Tracking Guardian
3. Click "Remove app"
4. Confirm removal
```

### 6.2 Verify Data Handling

```bash
# In App Database (or logs)
1. Shop record should have isActive=false
2. Sessions should be deleted
3. No new webhook processing for this shop

# 48 hours later (or via shop/redact webhook):
1. All shop data should be deleted
```

---

## 7. Origin Validation (Security Test)

### 7.1 Test from Invalid Origin

```bash
# Using curl (non-Shopify origin)
curl -X POST https://your-app.com/api/pixel-events \
  -H "Content-Type: application/json" \
  -H "Origin: https://malicious-site.com" \
  -d '{"eventName":"checkout_completed","shopDomain":"test.myshopify.com","timestamp":1234567890,"data":{}}'

# Expected: HTTP 403 Forbidden (P0-03 + P1-01 compliance)
```

### 7.2 Test from Shopify Origin

```bash
# Using curl (valid Shopify origin)
curl -X POST https://your-app.com/api/pixel-events \
  -H "Content-Type: application/json" \
  -H "Origin: https://test-store.myshopify.com" \
  -d '{"eventName":"checkout_completed","shopDomain":"test-store.myshopify.com","timestamp":1234567890,"data":{"orderId":"123"}}'

# Expected: HTTP 200 or 404 (shop not found, but not 403)
```

---

## 8. Rate Limiting (Security Test)

```bash
# Rapid requests test
for i in {1..60}; do
  curl -X POST https://your-app.com/api/pixel-events \
    -H "Content-Type: application/json" \
    -d '{"eventName":"checkout_completed","shopDomain":"test.myshopify.com","timestamp":1234567890,"data":{}}' &
done

# Expected: After ~50 requests, start seeing HTTP 429 Too Many Requests
```

---

## 9. PCD (Protected Customer Data) Compliance

### 9.1 Understanding PCD in This App

**Protected Customer Data (PCD)** access is **OPTIONAL** in this app:

| Mode | PCD Required? | Data Sent to Ad Platforms |
|------|---------------|---------------------------|
| **Privacy-First (Default)** | ❌ No | Order value, currency, SKU, quantity only |
| **Enhanced Matching (Opt-in)** | ✅ Yes | + Hashed email/phone for attribution |

### 9.2 How PII Toggle Works

```
Settings → Security & Privacy → PII Enhanced Matching

Default State: DISABLED ✅
- piiEnabled: false (in database)
- consentStrategy: "strict"
- No PCD review required
```

When merchant ENABLES PII:
1. Confirmation dialog explains compliance obligations
2. `pcdAcknowledged` field set to true with timestamp
3. Banner reminds merchant of their own compliance responsibilities (privacy policy, GDPR/CCPA/PIPL)
4. Note: The app (developer) has already completed PCD review - merchant does NOT need to do PCD review themselves

### 9.3 PCD Review Checklist

For App Store submission, include in listing:

```markdown
## Privacy & Data Handling

### Without Enhanced Matching (Default)
- Tracks conversion value and product info only
- No personal data collected or sent
- No PCD access required

### With Enhanced Matching (Optional)
- Sends hashed (SHA256) email/phone to ad platforms
- App developer has completed Shopify PCD review (merchant does NOT need to do this)
- Merchant acknowledges their own compliance responsibilities (privacy policy update, regional laws)
- Data used solely for attribution improvement
```

### 9.4 Technical Implementation

Database schema (privacy-first defaults):
```prisma
piiEnabled Boolean @default(false)  // PII OFF by default
pcdAcknowledged Boolean @default(false)  // Not acknowledged
pcdAcknowledgedAt DateTime?  // Timestamp when acknowledged
consentStrategy String @default("strict")  // Most restrictive
```

Code path for enabling PII:
```typescript
// app/routes/app.settings.tsx
if (piiEnabled && !pcdAcknowledged) {
  return json({
    success: false,
    message: "启用 PII 发送需要先确认您的合规义务",
    requirePcdAcknowledgement: true,
  });
}
```

---

## 10. Pre-Submission Checklist

### Scopes Verification
- [ ] `read_orders` - Used by webhooks.tsx for ORDERS_PAID
- [ ] `read_script_tags` - Used by scanner.server.ts for migration scan
- [ ] `read_pixels` - Used by migration.server.ts for getExistingWebPixels
- [ ] `write_pixels` - Used by migration.server.ts for webPixelCreate/webPixelUpdate
- [ ] **NO** `read_customer_events` - Not needed, we use webhooks not Customer Events API

### Privacy Verification
- [ ] Only checkout_completed events sent to backend
- [ ] Default: No PII collected or stored (piiEnabled=false)
- [ ] Default: No PII sent to ad platforms (privacy-first design)
- [ ] Optional PII requires explicit merchant acknowledgment (pcdAcknowledged)
- [ ] Consent is checked before any data processing (consentStrategy="strict")

### GDPR Verification
- [ ] customers/data_request handled
- [ ] customers/redact handled
- [ ] shop/redact handled
- [ ] Data retention configurable (30-365 days)

### Security Verification
- [ ] Origin validation on pixel endpoint
- [ ] Rate limiting on pixel endpoint
- [ ] Webhook HMAC verification
- [ ] Tokens encrypted at rest (AES-256-GCM)

### PCD Compliance Verification
- [ ] PII disabled by default
- [ ] Enabling PII requires confirmation dialog
- [ ] pcdAcknowledged timestamp recorded
- [ ] Banner reminds merchant of their compliance obligations (NOT Partner Dashboard - that's developer's job)

---

## 11. Screenshots to Capture

For review submission:

1. **App Installation Flow**
   - OAuth consent screen
   - App dashboard after install

2. **Web Pixel Settings**
   - Shopify Admin → Customer events showing pixel
   - Pixel settings showing only valid fields

3. **Network Tab Evidence**
   - Consent denied: no pixel requests
   - Consent accepted: checkout_completed only

4. **GDPR Handling**
   - GDPRJob records in database
   - Deletion confirmation logs

5. **Settings Page**
   - Ingestion key status
   - Privacy settings (showing PII DISABLED by default)
   - Data retention configuration

6. **PCD Path (if testing enhanced matching)**
   - PII toggle disabled by default
   - Confirmation dialog when enabling
   - PCD acknowledgment banner after enabling

---

## 12. App Store Listing Suggestions

### Short Description
```
Migrate legacy tracking scripts (ScriptTags, Additional Scripts) to Web Pixel + Server-side CAPI. 
Works without PII - conversion tracking only requires order data.
```

### Key Points for Listing
```
✅ Privacy-First: No customer personal data collected by default
✅ GraphQL-Only: Future-proof API compliance
✅ Checkout Extensibility: Ready for Shopify's new checkout
✅ GDPR Compliant: Full data request/deletion support
✅ Optional Enhanced Matching: For merchants needing higher attribution (app developer has completed PCD review)
```

### FAQ Suggestion
```
Q: Does this app access customer personal data?
A: By default, NO. The app tracks conversion value and product info only. 
   Enhanced matching (PII) is optional and requires merchant to complete 
   Shopify's Protected Customer Data review.

Q: What if I don't enable Enhanced Matching?
A: The app works perfectly without it. Most merchants achieve good attribution 
   with order-level data alone. PII is only needed for edge cases requiring 
   higher match rates.
```

---

## 13. Quick Reference: App Permissions & Data Access

### Scopes Used (Minimal)

| Scope | Used For | Justification |
|-------|----------|---------------|
| `read_orders` | ORDERS_PAID webhook | Required to receive conversion events |
| `read_script_tags` | Migration scanner | Identify legacy scripts needing migration |
| `read_pixels` | Web Pixel management | Check existing pixel configuration |
| `write_pixels` | Web Pixel management | Install/update our conversion pixel |

### Scopes NOT Requested

| Scope | Why Not Needed |
|-------|----------------|
| `read_customer_events` | We use webhooks, not Customer Events API |
| `read_customers` | We don't store customer data |
| `write_script_tags` | Not needed - we migrate TO pixels, not FROM |

### Data Flow Summary

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Customer checks │     │ Shopify sends    │     │ Our app sends   │
│ out on store    │ ──▶ │ ORDERS_PAID      │ ──▶ │ to ad platforms │
│                 │     │ webhook          │     │ via CAPI        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ Data sent:       │
                        │ • Order value    │
                        │ • Currency       │
                        │ • Order ID       │
                        │ • Items (SKU)    │
                        │ ─────────────────│
                        │ NOT sent:        │
                        │ • Email ❌       │
                        │ • Phone ❌       │
                        │ • Address ❌     │
                        └──────────────────┘
```

---

## 14. App Store Listing Recommended Content

### App Name
```
Tracking Guardian - Checkout Migration Tool
```

### Tagline (Short Description - 80 chars max)
```
Migrate checkout tracking to Web Pixel + CAPI. Works without customer emails.
```

### Long Description (App Store Listing)
```
🚀 PREPARE FOR SHOPIFY'S CHECKOUT UPGRADE

Shopify is deprecating checkout.liquid, Additional Scripts, and ScriptTags. 
Don't lose your conversion tracking when the deadline hits!

Tracking Guardian scans your store, identifies at-risk tracking scripts, 
and migrates them to Shopify's new Web Pixel + Server-side CAPI system.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ WHAT THIS APP DOES

1️⃣ SCAN - Detect legacy tracking scripts (Google, Meta, TikTok, etc.)
2️⃣ MIGRATE - Install Web Pixel with one click
3️⃣ TRACK - Send conversions via server-side CAPI
4️⃣ REPLACE - Optional Checkout UI blocks for surveys, upsells, shipping

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔒 PRIVACY-FIRST DESIGN

• Works WITHOUT customer emails or phone numbers
• Sends only: order value, currency, product info
• GDPR/CCPA compliant out of the box
• Optional enhanced matching (app developer has completed PCD review)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 KEY DEADLINES

• Feb 1, 2025: Can't create new ScriptTags for checkout
• Aug 28, 2025: Plus merchants - scripts stop executing
• Aug 26, 2026: All merchants - scripts stop executing

Don't wait until the last minute. Migrate today!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 WHO IS THIS FOR?

• Merchants using Google Ads, Meta Ads, TikTok Ads
• Anyone with tracking scripts in checkout.liquid
• Stores preparing for Checkout Extensibility upgrade
• Agencies managing multiple store migrations
```

### Key Selling Points (Bullet Points for Listing)
```
✅ 100% conversion tracking - without needing customer emails
✅ Future-proof - ready for Shopify's checkout extensibility
✅ Privacy-first - GDPR/CCPA compliant by default
✅ Server-side tracking - not affected by ad blockers or iOS ATT
✅ Complete migration - tracking, surveys, upsells in one app
✅ ROI calculator - see exactly what you'll lose without migration
```

### FAQ for Listing
```
Q: Does this app collect customer personal data?
A: By default, NO. The app tracks conversions using order data only 
   (value, currency, items). Enhanced matching with hashed emails is 
   optional and requires explicit merchant consent. The app developer 
   has already completed Shopify PCD review.

Q: What happens to my current tracking scripts?
A: The app scans your existing scripts, shows what needs migration, 
   and helps you set up the new Web Pixel + CAPI system. Your old 
   scripts can remain active until Shopify's deprecation deadline.

Q: Do I need to be a Shopify Plus merchant?
A: No! While Plus merchants have earlier deadlines for migration, 
   this app works for all merchants and helps everyone prepare for 
   the inevitable transition to Checkout Extensibility.

Q: Why include Survey/Upsell/Shipping blocks?
A: These replace common functionality that merchants previously 
   implemented via checkout.liquid additional scripts. By including 
   them, we provide a complete migration path in one app.

Q: How is this different from other tracking apps?
A: Most apps just add new tracking. We focus on MIGRATION - helping 
   you transition from legacy scripts to the new platform before 
   Shopify's deadlines hit and your tracking breaks.

Q: What if I don't migrate in time?
A: Your existing tracking scripts will stop executing on checkout 
   pages after the deadline. You'll lose conversion data, which can 
   severely impact your ad campaign optimization and ROAS.
```

---

## 15. CRITICAL: Reviewer Notes on Checkout UI Extensions

### Why We Include Thank You / Order Status Blocks

**Important for App Reviewers**: The Checkout UI Extension blocks (Survey, Shipping Tracker, Upsell) are NOT separate products or add-on features. They are an **integral part of the checkout migration solution**.

#### The Problem We Solve

Before Checkout Extensibility, merchants commonly used Additional Scripts in checkout.liquid to:
1. Show post-purchase surveys
2. Display shipping tracking widgets
3. Offer upsells on the thank you page
4. Fire conversion tracking pixels

**All of this functionality will break** when Shopify deprecates checkout.liquid.

#### Our Solution

We provide a **complete migration path** in one app:

| Legacy Method | Our Replacement | Technology |
|---------------|-----------------|------------|
| ScriptTag tracking | Web Pixel + CAPI | `web_pixel_extension` |
| Additional Scripts tracking | Server-side webhook | Orders/Paid webhook |
| Additional Scripts survey | Survey Block | `checkout_ui_extension` |
| Additional Scripts shipping | Shipping Tracker Block | `checkout_ui_extension` |
| Additional Scripts upsell | Upsell Block | `checkout_ui_extension` |

#### Why This Matters for Review

1. **Single Value Proposition**: "Migrate your checkout" - not "Tracking + Survey + Upsell"
2. **Completes the Migration**: Without these blocks, merchants would need multiple apps
3. **Follows Shopify Guidelines**: Using official Checkout UI Extension API
4. **Not Feature Creep**: Each block directly replaces a legacy checkout.liquid capability

#### How to Test the Blocks

1. Go to Shopify Admin → Settings → Checkout → Customize
2. In the checkout customizer, navigate to Thank You or Order Status section
3. Click "Add block" and select from Tracking Guardian blocks
4. Configure the block and save
5. Complete a test order to see the block in action

---

## 16. Scope Justification Summary

| Scope | Why We Need It | Where It's Used |
|-------|----------------|-----------------|
| `read_orders` | Receive order data for CAPI | `webhooks.tsx` → orders/paid |
| `read_script_tags` | Scan legacy tracking scripts | `scanner.server.ts` |
| `read_pixels` | Check existing pixel config | `migration.server.ts` |
| `write_pixels` | Install our Web Pixel | `migration.server.ts` |

### Scopes We Deliberately Don't Request

| Scope | Why We Don't Need It |
|-------|---------------------|
| `read_customer_events` | We use webhooks, not Customer Events API |
| `read_customers` | We don't store customer profiles |
| `write_script_tags` | We migrate away from ScriptTags, not to them |
| `read_checkouts` | Webhook provides necessary data |

---

*Document Version: 1.3*
*Last Updated: 2025-01*
*For Shopify App Store Review*

