# Tracking Guardian - App Store Review Playbook

This document provides step-by-step testing procedures for Shopify App Store review.

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
4. Verify only "Ingestion Key" and "Debug Mode" settings are visible
5. NO "Backend URL" setting should exist (P0-01 compliance)
```

**Expected Result**: Pixel is installed, settings match extension schema.

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

## 9. Pre-Submission Checklist

### Scopes Verification
- [ ] `read_orders` - Used by webhooks.tsx for ORDERS_PAID
- [ ] `read_script_tags` - Used by scanner.server.ts for migration scan
- [ ] `write_pixels` - Used by migration.server.ts for webPixelCreate
- [ ] `read_customer_events` - Required for Web Pixel events

### Privacy Verification
- [ ] Only checkout_completed events sent to backend
- [ ] No PII stored in database (email, phone, address)
- [ ] PII is hashed before sending to ad platforms
- [ ] Consent is checked before any data processing

### GDPR Verification
- [ ] customers/data_request handled
- [ ] customers/redact handled
- [ ] shop/redact handled
- [ ] Data retention configurable (30-365 days)

### Security Verification
- [ ] Origin validation on pixel endpoint
- [ ] Rate limiting on pixel endpoint
- [ ] Webhook HMAC verification
- [ ] Tokens encrypted at rest

---

## 10. Screenshots to Capture

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
   - Privacy settings
   - Data retention configuration

---

*Document Version: 1.0*
*Last Updated: 2024-12*
*For Shopify App Store Review*

