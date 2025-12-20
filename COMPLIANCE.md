# Tracking Guardian - Data Compliance Documentation

## Protected Customer Data Declaration

This document outlines how Tracking Guardian handles customer data in compliance with Shopify's Protected Customer Data requirements and GDPR/privacy regulations.

---

## 1. Data Collection Summary

### Data Accessed via Shopify APIs

| Data Type | API/Source | Purpose | Retention |
|-----------|-----------|---------|-----------|
| Order ID | `orders/paid` webhook | Conversion tracking & deduplication | Configurable (default 90 days) |
| Order Number | `orders/paid` webhook | Display in dashboard | Configurable (default 90 days) |
| Order Value | `orders/paid` webhook | Revenue attribution | Configurable (default 90 days) |
| Currency | `orders/paid` webhook | Accurate conversion reporting | Configurable (default 90 days) |
| Line Items | `orders/paid` webhook | Product-level attribution | Configurable (default 90 days) |
| Checkout Token | `orders/paid` webhook | Event correlation | Configurable (default 90 days) |

### Protected Customer Data (if PCD access granted)

| Data Type | Purpose | Processing | Storage |
|-----------|---------|------------|---------|
| Email | Enhanced matching for ad platforms | Hashed (SHA-256) before sending | NOT stored (transient) |
| Phone | Enhanced matching for ad platforms | Hashed (SHA-256) before sending | NOT stored (transient) |
| Name | Enhanced matching for ad platforms | Hashed (SHA-256) before sending | NOT stored (transient) |
| Address | Enhanced matching for ad platforms | Hashed (SHA-256) before sending | NOT stored (transient) |

**Note:** Protected Customer Data is ONLY processed when:
1. The merchant explicitly enables "Enhanced Matching" in settings
2. Customer has provided consent (verified via PixelEventReceipt)
3. Data is immediately hashed and transmitted, never stored in plaintext

---

## 2. Data Processing Purposes

### Primary Purpose: Server-Side Conversion Tracking

Tracking Guardian processes order data to:
1. **Send conversion events to ad platforms** (Google GA4, Meta CAPI, TikTok Events API)
2. **Deduplicate events** between client-side pixel and server-side API
3. **Provide reconciliation reports** comparing Shopify orders with platform-reported conversions

### Why We Need This Data

- **Order ID/Number**: Deduplication prevents double-counting conversions
- **Order Value**: Accurate revenue attribution for ROAS calculation
- **Line Items**: Product-level conversion tracking (optional)
- **Email/Phone (PCD)**: Enhanced matching improves attribution accuracy (optional)

---

## 3. Data Minimization

### Principle: Collect Only What's Necessary

1. **No unnecessary PII storage**: Email, phone, name, address are NEVER stored in our database
2. **Hashing before transmission**: All PII sent to ad platforms is SHA-256 hashed
3. **Configurable retention**: Merchants control how long we retain conversion logs
4. **Automatic cleanup**: Data older than retention period is automatically deleted

### What We DON'T Collect

- Customer browsing history
- Device fingerprints
- IP addresses (except for rate limiting, not stored)
- Payment information
- Detailed customer profiles

---

## 4. Data Retention & Deletion

### Automatic Retention Policy

| Data Type | Default Retention | Configurable |
|-----------|------------------|--------------|
| ConversionLog | 90 days | Yes (0-365 days) |
| PixelEventReceipt | 90 days | Yes |
| SurveyResponse | 90 days | Yes |
| AuditLog | 180 days | Yes |
| WebhookLog | 90 days | Yes |

### GDPR Compliance Webhooks

We fully implement Shopify's mandatory compliance webhooks:

#### `customers/data_request`
- **Response**: Export all data associated with specified order IDs
- **Timeline**: Completed within 30 days
- **Data included**: Conversion logs, survey responses, pixel receipts

#### `customers/redact`
- **Action**: Delete all data for specified orders
- **Scope**: ConversionLog, ConversionJob, PixelEventReceipt, SurveyResponse
- **Idempotency**: Safe to retry without side effects

#### `shop/redact`
- **Action**: Delete ALL data for the shop (mandatory 48h after uninstall)
- **Scope**: Complete data deletion including Sessions, all conversion data, configs
- **Independence**: Executes regardless of shop active status

---

## 5. Security Measures

### Encryption

| Data | Method | Key Management |
|------|--------|----------------|
| Access Token | AES-256-GCM | Environment variable |
| Ingestion Secret | AES-256-GCM | Environment variable |
| Platform Credentials | AES-256-GCM | Environment variable |

### Access Control

- **API Authentication**: All API endpoints require valid session/signature
- **Webhook Verification**: HMAC signature validation for all webhooks
- **Pixel Signing**: Client-to-server requests signed with shop-specific secret
- **Rate Limiting**: Protection against abuse and brute force

### Audit Logging

All sensitive operations are logged:
- Token updates
- Configuration changes
- Data deletion requests
- GDPR compliance actions

---

## 6. Consent Management

### Three-Tier Consent Strategy

| Strategy | Behavior | Recommended For |
|----------|----------|-----------------|
| **strict** (default) | Requires explicit consent receipt | All production deployments |
| **balanced** | Analytics allowed, marketing requires receipt | Shops with mixed requirements |
| **weak** | Implied consent | Regions with implied consent laws |

### Customer Privacy API Integration

- Web Pixel reads consent state from Shopify's Customer Privacy API
- Consent state recorded in PixelEventReceipt
- Server respects consent for CAPI decisions

---

## 7. Third-Party Data Sharing

### Ad Platforms Receiving Data

| Platform | Data Shared | Purpose | User Control |
|----------|-------------|---------|--------------|
| Google GA4 | Order ID, Value, Items | Conversion measurement | Consent required |
| Meta CAPI | Order ID, Value, Hashed PII | Attribution | Consent required |
| TikTok Events | Order ID, Value, Hashed PII | Attribution | Consent required |

### What's Shared

- Event type (purchase)
- Order value and currency
- Hashed identifiers (only if PCD enabled + consent)
- Event timestamp

### What's NOT Shared

- Raw email/phone/name
- Full address details
- Payment information
- Customer account data

---

## 8. Merchant Responsibilities

By using Tracking Guardian, merchants agree to:

1. **Privacy Policy**: Disclose use of server-side tracking to customers
2. **Consent Collection**: Implement proper consent collection for their region
3. **Data Processor Agreement**: Sign DPA if required by their jurisdiction
4. **Platform Terms**: Comply with ad platform terms of service

---

## 9. Contact & Data Requests

For data-related inquiries or requests:

- **Data Export Requests**: Automatically handled via Shopify webhook
- **Data Deletion Requests**: Automatically handled via Shopify webhook
- **Security Concerns**: Contact app developer via Shopify Partner dashboard

---

## 10. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-12 | Initial compliance documentation |
| 1.1 | 2024-12 | Updated consent strategy (default: strict) |

---

*This document is provided for Shopify App Review and merchant transparency.*
