# Tracking Guardian - Privacy Policy

**Last Updated:** December 2024

This privacy policy describes how Tracking Guardian ("we", "our", "the App") collects, uses, and protects data when merchants install and use our Shopify application.

---

## 1. Data We Collect

### 1.1 Order Data (from Shopify Webhooks)

| Data Field | Purpose | Storage | Retention |
|------------|---------|---------|-----------|
| Order ID | Conversion tracking & deduplication | Yes | Configurable (30-365 days) |
| Order Number | Display in dashboard | Yes | Configurable |
| Order Value | Revenue attribution | Yes | Configurable |
| Currency | Accurate conversion reporting | Yes | Configurable |
| Line Items | Product-level attribution | Yes | Configurable |
| Checkout Token | Event correlation | Yes | Configurable |

### 1.2 Pixel Event Data (from Web Pixel)

| Data Field | Purpose | Storage | Retention |
|------------|---------|---------|-----------|
| Event Type | Identify checkout_completed events | Yes | Configurable |
| Event Timestamp | Event timing & deduplication | Yes | Configurable |
| Consent State | Verify customer consent | Yes | Configurable |
| Shop Domain | Multi-shop identification | Yes | Configurable |

### 1.3 What We DO NOT Collect

**P0-02 Compliance: Our Web Pixel ONLY sends `checkout_completed` events.**

We explicitly DO NOT collect:
- ❌ Page views / browsing history
- ❌ Product views
- ❌ Add to cart events
- ❌ Checkout started events
- ❌ Customer email addresses
- ❌ Customer phone numbers
- ❌ Customer names or addresses
- ❌ Payment information
- ❌ Device fingerprints
- ❌ IP addresses (used transiently for rate limiting, not stored)

---

## 2. How We Use Data

### 2.1 Primary Purpose: Server-Side Conversion Tracking

We process order data to:
1. **Send conversion events** to advertising platforms (Google GA4, Meta CAPI, TikTok Events API)
2. **Deduplicate events** between client-side pixel and server-side API
3. **Provide reconciliation reports** comparing Shopify orders with platform-reported conversions

### 2.2 Consent Requirements

We only process data when customers have provided appropriate consent:

| Consent Type | Pixel Loads? | Data Sent to Ad Platforms? |
|--------------|--------------|---------------------------|
| Analytics + Marketing | ✅ Yes | ✅ Yes |
| Analytics only | ❌ No | ❌ No |
| Marketing only | ❌ No | ❌ No |
| Sale of Data Opt-Out | ✅ May load | ❌ No |

---

## 3. Third-Party Data Sharing

### 3.1 Advertising Platforms

When merchants configure server-side tracking AND customers consent, we share order data with:

| Platform | Data Shared | Purpose |
|----------|-------------|---------|
| Google GA4 | Order ID, Value, Currency, Items | Conversion measurement |
| Meta CAPI | Order ID, Value, Currency, Items | Attribution |
| TikTok Events API | Order ID, Value, Currency, Items | Attribution |

### 3.2 What We Share

- Event type (purchase)
- Order value and currency
- Line items (product IDs, quantities)
- Event timestamp
- Event ID (for deduplication)

### 3.3 What We DO NOT Share

- Customer email addresses
- Customer phone numbers
- Customer names
- Customer addresses
- Payment details

---

## 4. Data Retention & Deletion

### 4.1 Configurable Retention

Merchants can configure data retention period (30-365 days). After this period, data is automatically deleted.

| Data Type | Default Retention |
|-----------|------------------|
| Conversion Logs | 90 days |
| Pixel Event Receipts | 90 days |
| Survey Responses | 90 days |
| Audit Logs | 365 days |

### 4.2 GDPR Compliance

We implement Shopify's mandatory compliance webhooks:

#### `customers/data_request`
- Locates all data associated with specified orders
- Returns counts and metadata
- Job completed within 30 days

#### `customers/redact`
- Deletes all customer-related data for specified orders
- Affects: ConversionLog, PixelEventReceipt, SurveyResponse
- Idempotent - safe to retry

#### `shop/redact`
- Deletes ALL shop data 48 hours after uninstall
- Complete data deletion including configurations
- Automatic - no merchant action required

---

## 5. Security Measures

### 5.1 Encryption

| Data | Encryption Method |
|------|-------------------|
| Access Tokens | AES-256-GCM |
| API Credentials | AES-256-GCM |
| Alert Webhook URLs | AES-256-GCM |

### 5.2 Access Control

- All API endpoints require valid Shopify session
- Webhooks verified via HMAC signature
- Origin validation for pixel events
- Rate limiting per shop and globally

### 5.3 Audit Logging

We log all sensitive operations:
- Token updates
- Configuration changes
- Data deletion requests
- GDPR compliance actions

---

## 6. Merchant Responsibilities

By using Tracking Guardian, merchants agree to:

1. **Disclose** the use of server-side conversion tracking to their customers
2. **Implement** proper consent collection for their target markets
3. **Comply** with advertising platform terms of service
4. **Configure** appropriate data retention periods

---

## 7. Changes to This Policy

We may update this privacy policy to reflect changes in our practices or legal requirements. Significant changes will be communicated through the App interface.

---

## 8. Contact Information

For privacy-related inquiries:
- **Data Requests**: Automatically handled via Shopify webhooks
- **Questions**: Contact app developer via Shopify Partner Dashboard

---

## 9. Regional Compliance

### 9.1 GDPR (European Union)

- Data minimization: We collect only what's necessary
- Purpose limitation: Data used only for stated purposes
- Storage limitation: Configurable retention with automatic deletion
- Rights support: Access and deletion via Shopify webhooks

### 9.2 CCPA (California)

- Sale of data opt-out: Respected via `sale_of_data` consent signal
- Do Not Sell: When customer opts out, no data shared with ad platforms

### 9.3 Other Regions

Our default "strict" consent mode ensures compliance with most privacy regulations by requiring explicit consent before any data processing.

---

*This privacy policy is provided for Shopify App Review and merchant transparency.*

