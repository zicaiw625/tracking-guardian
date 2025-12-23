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

**Shopify PCD Access Control:**
- The app developer has completed Shopify's Protected Customer Data (PCD) review process
- PCD fields (email, phone, name, address) are only accessible when the app has been granted PCD access
- Without PCD approval, these fields may be unavailable or return null from Shopify APIs
- Merchants do NOT need to complete PCD review themselves - this is the developer's responsibility

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

1. **No customer PII for tracking**: Email, phone, name, address are NOT collected, stored, or sent to ad platforms
2. **Order data only**: We only process order ID, value, currency, and line items for conversion tracking
3. **Configurable retention**: Merchants control how long we retain conversion logs
4. **Automatic cleanup**: Data older than retention period is automatically deleted

**Privacy-First Approach**: We do not use hashed PII for ad platform matching. While this may reduce match rates, it provides stronger privacy guarantees and simpler compliance.

### Clarification on Personal Data (for Compliance Review)

While we do NOT collect customer PII for advertising purposes, we do process some data that may constitute "personal data" under GDPR/CCPA for **operational and security purposes**:

| Data Type | Category | Purpose | GDPR Deletion |
|-----------|----------|---------|---------------|
| IP Address | Transient / Audit | Rate limiting, security audit | ✅ Deleted on shop/redact |
| Survey Feedback | User-provided | Post-purchase surveys | ✅ Deleted on shop/redact |
| Staff Session | OAuth | Admin authentication | ✅ Deleted on shop/redact |

**Key Points for Review:**
- IP addresses are used **transiently** for rate limiting and logged to AuditLog for abuse detection only
- Survey feedback is **optional free-text**; customers may choose to include contact info
- All above data is subject to GDPR deletion requests via `shop/redact` and `customers/redact` webhooks
- **We do NOT** use any of this data for ad targeting or cross-site tracking

### Operational Data (Non-Customer PII)

The following data is stored for operational purposes and is **not customer PII**, but may contain personal information of **store staff or survey respondents**:

| Data Type | Table | Purpose | Retention | Notes |
|-----------|-------|---------|-----------|-------|
| Staff Email/Name | `Session` | Shopify OAuth sessions | Until logout/uninstall | Shopify-provided session data |
| IP Address | `AuditLog` | Security audit trails | 180 days | For abuse detection only |
| User Agent | `AuditLog` | Security audit trails | 180 days | Browser/device info |
| Survey Feedback | `SurveyResponse` | Post-purchase surveys | 90 days | Free-text, may contain PII entered by customer |

**Important Notes:**
- Session data contains store **staff/admin** information, not customer PII
- AuditLog IP/UA is for security monitoring, not customer tracking
- SurveyResponse feedback is voluntary free-text; customers may choose to include contact info
- All above data is subject to GDPR deletion requests via `shop/redact` webhook

### What We DON'T Collect for Advertising

**P0-02 Compliance: Our Web Pixel ONLY sends checkout_completed events.**

The following data is **NOT collected or sent to ad platforms**:

- ❌ Page views / browsing history (not collected)
- ❌ Product views (not collected)
- ❌ Add to cart events (not collected)
- ❌ Checkout started events (not collected)
- ❌ Customer email / phone / name / address (not sent to CAPI)
- ❌ Device fingerprints
- ❌ Payment information
- ❌ Detailed customer profiles

**IP Address Note**: IP addresses are used transiently for rate limiting and may be logged in AuditLog for security purposes (180-day retention). They are NOT used for customer tracking or sent to ad platforms. All audit data is deleted upon `shop/redact` webhook.

**Verification**: Check `extensions/tracking-pixel/src/index.ts` - uses `subscribeToCheckoutCompleted()` which ONLY subscribes to `checkout_completed`.

### P0-04: Consent Default Values (Strict Mode)

As of this version, consent handling follows **strict deny-by-default**:

| Field | Default | Interpretation |
|-------|---------|----------------|
| `marketingAllowed` | `false` | Must be explicitly `=== true` to allow |
| `analyticsProcessingAllowed` | `false` | Must be explicitly `=== true` to allow |
| `saleOfDataAllowed` | `false` | Must be explicitly `=== true` to allow |

**Key Change**: Previously, `undefined` or missing `saleOfData` was treated as "allowed". Now it is treated as "NOT allowed". This is the most privacy-protective default.

**Verification**: Check `extensions/tracking-pixel/src/consent.ts` and `app/utils/platform-consent.ts` for P0-04 comments.

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
- **Response**: Locate and count all data associated with specified order IDs
- **Timeline**: Job queued immediately, completed within 30 days
- **Data located**: Conversion logs, survey responses, pixel receipts
- **Output**: Returns counts and metadata; full data export available via support request
- **Note**: For complete data export, contact support with the data_request_id from the job result

#### `customers/redact`
- **Action**: Delete all data for specified orders
- **Scope**: ConversionLog, ConversionJob, PixelEventReceipt, SurveyResponse
- **Idempotency**: Safe to retry without side effects

#### `shop/redact`
- **Action**: Delete ALL data for the shop (mandatory 48h after uninstall)
- **Scope**: Complete data deletion including Sessions, all conversion data, configs
- **Independence**: Executes regardless of shop active status

### GDPR Webhook Testing Steps

#### Prerequisites
1. A development store with the app installed
2. At least one test order completed
3. Access to Shopify Partner Dashboard

#### Test 1: customers/data_request

**How to trigger:**
```bash
# Option A: Via Shopify Admin (Recommended)
# 1. Go to Settings > Privacy & security > View customer data
# 2. Search for a customer by email
# 3. Click "Request data"

# Option B: Via Shopify CLI (Development)
shopify app webhook trigger --topic customers/data_request --address https://your-app-url.com/webhooks
```

**Expected behavior:**
1. GDPRJob created with status="queued"
2. Job processed within cron cycle
3. GDPRJob status updated to "completed"
4. Result contains data counts for the customer

**Verification query:**
```sql
SELECT * FROM "GDPRJob" 
WHERE "jobType" = 'data_request' 
ORDER BY "createdAt" DESC 
LIMIT 1;
```

#### Test 2: customers/redact

**How to trigger:**
```bash
# Option A: Via Shopify Admin
# 1. Go to Settings > Privacy & security > Customer data erasure requests
# 2. Click "Submit erasure request" for a customer

# Option B: Via Shopify CLI (Development)
shopify app webhook trigger --topic customers/redact --address https://your-app-url.com/webhooks
```

**Expected behavior:**
1. GDPRJob created with status="queued"
2. All customer data deleted from:
   - ConversionLog (matching order IDs)
   - ConversionJob (matching order IDs)
   - PixelEventReceipt (matching order IDs)
   - SurveyResponse (matching order IDs)
3. GDPRJob status updated to "completed" with deletion counts

**Verification query:**
```sql
-- Check deletion job
SELECT * FROM "GDPRJob" 
WHERE "jobType" = 'customer_redact' 
ORDER BY "createdAt" DESC 
LIMIT 1;

-- Verify data removed (should return 0)
SELECT COUNT(*) FROM "ConversionLog" 
WHERE "orderId" IN ('order_id_1', 'order_id_2');
```

#### Test 3: shop/redact

**How to trigger:**
```bash
# Option A: Uninstall and wait 48 hours
# The webhook fires automatically after uninstall

# Option B: Via Shopify CLI (Development - immediate test)
shopify app webhook trigger --topic shop/redact --address https://your-app-url.com/webhooks
```

**Expected behavior:**
1. GDPRJob created with status="queued"
2. ALL shop data deleted:
   - Shop record (cascading to all related records)
   - Sessions
   - All ConversionLogs
   - All PixelConfigs
   - All AlertConfigs
   - etc.
3. GDPRJob status updated to "completed"

**Verification query:**
```sql
-- Check shop no longer exists
SELECT * FROM "Shop" WHERE "shopDomain" = 'test-store.myshopify.com';

-- Check GDPR job completed
SELECT * FROM "GDPRJob" 
WHERE "jobType" = 'shop_redact' 
AND "shopDomain" = 'test-store.myshopify.com';
```

#### Automated Test Suite

Run the GDPR test suite:
```bash
npm run test -- tests/webhooks/gdpr.test.ts
```

This covers:
- Webhook signature verification
- Job creation and processing
- Data deletion validation
- Idempotency checks

---

## 4.5 Partner Dashboard - Protected Customer Data Declaration

### Required Actions Before App Store Submission

Before submitting to Shopify App Store, you MUST complete these steps in Partner Dashboard:

#### Step 1: Navigate to App Settings
1. Go to [partners.shopify.com](https://partners.shopify.com)
2. Select your app → "Configuration" → "App access"
3. Find "Protected customer data access" section

#### Step 2: Declare Data Access Levels

Based on our implementation, declare the following:

| Data Type | Access Level | Justification |
|-----------|--------------|---------------|
| Orders | Level 1 | Required for conversion tracking reconciliation (`reconciliation.server.ts`) |
| Customer data | Not Required | We do NOT access email/phone/name/address |
| Marketing | Optional | Only if merchant enables enhanced matching (currently disabled) |

#### Step 3: Complete Privacy Policy

Ensure your privacy policy includes:
- What data is collected (order ID, value, currency, items)
- How data is used (conversion tracking, reconciliation)
- Data retention period (configurable, default 90 days)
- GDPR rights (access, deletion)
- Third-party sharing (Google, Meta, TikTok with consent)

#### Step 4: Verify Webhook Compliance

Confirm mandatory webhooks are registered:
- ✅ `customers/data_request` - Implemented
- ✅ `customers/redact` - Implemented
- ✅ `shop/redact` - Implemented

#### Important Notes

1. **Level 1 Access**: Our `read_orders` scope for reconciliation reports falls under Level 1 protected data
2. **No PII Storage**: We don't store email/phone/name, so Level 2+ is NOT required
3. **Review Timeline**: Protected Customer Data review may take 2-4 weeks

---

## 5. Security Measures

### Encryption

| Data | Method | Key Management |
|------|--------|----------------|
| Access Token | AES-256-GCM | Environment variable |
| Ingestion Secret | AES-256-GCM | Environment variable |
| Platform Credentials | AES-256-GCM | Environment variable |

### Access Control

- **API Authentication**: All API endpoints require valid session
- **Webhook Verification**: HMAC signature validation for all webhooks (Shopify-signed)
- **Pixel Event Security**:
  - **P1-01: Ingestion Key (Token) - NOT a Secret**: 
    - **IMPORTANT**: The "ingestion key" (database field: `ingestionSecret`) is **NOT a cryptographic secret**
    - It is a **store-scoped identifier/token** visible in browser Network requests
    - The HTTP header is named `X-Tracking-Guardian-Key` (not "secret") to reflect this
    - Purpose: Correlate pixel events to the correct store, NOT strong authentication
    - Why "ingestionSecret" name in DB? Historical naming + field IS encrypted at rest
    - Missing/invalid keys result in 204 No Content (silent drop)
  - **P1-01: Actual Security Measures (Multi-Layer)**:
    - **Checkout Token Binding**: Pixel's `checkoutToken` verified against webhook's `checkout_token`
    - **Origin Validation**: Only accept requests from shop's allowed domains (per-shop allowlist)
    - **Timestamp Window**: Reject requests outside 10-minute window
    - **Nonce/Replay Protection**: Same event cannot be submitted twice within 1 hour
    - **Trust Levels**: `trusted` (token binding verified) vs `partial` vs `untrusted`
  - **P1-01: Abuse Prevention Validation**:
    - `checkoutToken`: Must be 8-128 characters, alphanumeric with `-_`
    - `orderId`: Must be numeric or Shopify GID format
    - `timestamp`: Must be between 2020 and 24h in the future
    - `consent`: All fields must be boolean if present
    - Invalid format results in 400 Bad Request or 204 silent drop
  - **Rate Limiting**: Per-shop and global limits prevent abuse
  - **Order Verification**: orderId validated against shop's orders via webhook
- **Rate Limiting**: Protection against abuse and brute force

### Audit Logging

All sensitive operations are logged:
- Token updates
- Configuration changes
- Data deletion requests
- GDPR compliance actions

---

## 6. Consent Management

### Two-Tier Consent Strategy

| Strategy | Behavior | Recommended For |
|----------|----------|-----------------|
| **strict** (default) | Requires trusted pixel receipt + explicit consent | All production deployments, GDPR/CCPA regions |
| **balanced** | Allows partial-trust receipts, marketing still requires consent | Shops with mixed requirements |

> **Note**: The legacy "weak" mode (implied consent) is deprecated and no longer available in the UI. Existing shops using weak mode should migrate to balanced or strict.

### P1-04: Customer Privacy Configuration Strategy

The `shopify.extension.toml` declares our pixel's consent requirements:

```toml
[customer_privacy]
  analytics = true      # Pixel requires analytics consent
  marketing = true      # Pixel requires marketing consent  
  preferences = false   # Preferences not required
  sale_of_data = "enabled"  # Respects CCPA opt-out
```

**What This Means:**
- The pixel will **ONLY load** when the visitor has granted BOTH analytics AND marketing consent
- This is the most privacy-protective configuration (P0-04 strict defaults)
- Trade-off: Lower coverage (pixel doesn't fire for visitors who haven't consented)

**Alternative Strategies (Not Currently Implemented):**

| Strategy | Configuration | Coverage | Compliance Risk |
|----------|---------------|----------|-----------------|
| **Strict (Current)** | analytics=true, marketing=true | Lower | Lowest |
| **Analytics-Only** | analytics=true, marketing=false | Higher | Must not send to marketing platforms |
| **Minimal** | analytics=false, marketing=false | Highest | May load before consent, must handle in-pixel |

**Important**: If you modify these settings, ensure your server-side code (`platform-consent.ts`) 
correctly gates which platforms receive data based on actual consent state.

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
| Meta CAPI | Order ID, Value, Items | Attribution | Consent required |
| TikTok Events | Order ID, Value, Items | Attribution | Consent required |

**Note**: No PII (email, phone, address) is sent to any platform. This is a privacy-first design choice.

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
| 1.2 | 2025-12 | P0/P1 security and compliance hardening |
| 1.3 | 2025-12 | P0 minimum viable: orderPayload removal, additionalScripts removal, GDPR monitoring |

---

## 11. Field-Level Data Inventory (PCD Review Ready)

This section provides a complete inventory of all database fields for Shopify Protected Customer Data review.

### Table: ConversionLog

| Field | Type | Contains PII | Purpose | Retention |
|-------|------|--------------|---------|-----------|
| id | String | ❌ No | Primary key | Configurable |
| shopId | String | ❌ No | Shop reference | Configurable |
| orderId | String | ❌ No | Shopify order ID | Configurable |
| orderNumber | String | ❌ No | Display order number | Configurable |
| orderValue | Decimal | ❌ No | Order total for attribution | Configurable |
| currency | String | ❌ No | Currency code | Configurable |
| eventId | String | ❌ No | Deduplication ID | Configurable |
| platform | String | ❌ No | Target platform | Configurable |
| eventType | String | ❌ No | Event type (purchase) | Configurable |
| status | String | ❌ No | Processing status | Configurable |
| platformResponse | Json | ❌ No | Platform API response | Configurable |

### Table: ConversionJob

| Field | Type | Contains PII | Purpose | Retention |
|-------|------|--------------|---------|-----------|
| id | String | ❌ No | Primary key | Configurable |
| orderId | String | ❌ No | Shopify order ID | Configurable |
| capiInput | Json | ❌ No | Minimal CAPI payload (NO raw PII) | Configurable |
| consentEvidence | Json | ❌ No | Audit trail of consent decision | Configurable |
| trustMetadata | Json | ❌ No | Trust verification audit | Configurable |

**Note**: `orderPayload` field has been **REMOVED** (Migration 20251221100000).

### Table: ScanReport

| Field | Type | Contains PII | Purpose | Retention |
|-------|------|--------------|---------|-----------|
| scriptTags | Json | ❌ No | ScriptTag URLs only (no content) | Keep last 5 |
| identifiedPlatforms | String[] | ❌ No | Detected tracking platforms | Keep last 5 |
| riskItems | Json | ❌ No | Risk assessment results | Keep last 5 |

**Note**: `additionalScripts` field has been **REMOVED** (Migration 20251221100001).

### Table: AuditLog

| Field | Type | Contains PII | Purpose | Retention |
|-------|------|--------------|---------|-----------|
| actorId | String | ⚠️ May | Actor identifier (may be staff email) | 180 days |
| ipAddress | String | ⚠️ May | Request IP (GDPR: personal data) | 180 days |
| userAgent | String | ⚠️ May | Browser/device info | 180 days |

### Table: Session (Shopify OAuth)

| Field | Type | Contains PII | Purpose | Retention |
|-------|------|--------------|---------|-----------|
| accessToken | String | 🔒 Encrypted | AES-256-GCM encrypted | Until logout |
| email | String | ⚠️ May | Staff member email | Until logout |
| firstName | String | ⚠️ May | Staff member first name | Until logout |
| lastName | String | ⚠️ May | Staff member last name | Until logout |

**Note**: Session data contains **store staff/admin** information, NOT customer PII.

### Legend

- ❌ No = Does NOT contain PII
- ⚠️ May = May contain PII (requires GDPR handling)
- 🔒 Encrypted = Contains secrets (encrypted at rest)

### Data Deletion Guarantees

All ⚠️ marked fields are deleted upon:
- `customers/redact` webhook (customer-specific data)
- `shop/redact` webhook (all shop data)
- Automatic retention cleanup (based on `Shop.dataRetentionDays`)

---

## App Store Review Checklist

本节提供 Shopify App Store 审核所需的自检清单和测试步骤。

### Pre-Submission Checklist

#### Data Protection Details (Partner Dashboard)
- [ ] 声明收集的数据类型: Order ID, Order Value, Currency, Line Items
- [ ] 声明数据用途: Conversion tracking, Attribution, Reconciliation
- [ ] 声明数据保留期: Configurable 30-365 days
- [ ] 声明数据删除方式: Automatic retention-based + GDPR webhooks
- [ ] 声明第三方分享: Google, Meta, TikTok (订单金额、商品信息，不含 PII)

#### Privacy & Security
- [ ] Privacy Policy 链接可访问且内容匹配应用功能
- [ ] Terms of Service 链接可访问
- [ ] Support 联系方式有效
- [ ] 确认 scopes 最小化 (见下方)

#### Scopes Justification (P0-04 + P2-04)
| Scope | 必要性解释 | 代码调用点 | 对应功能 | 首次安装必需? |
|-------|-----------|-----------|---------|--------------|
| `read_orders` | 接收 orders/paid webhook 以发送转化事件 | `app/routes/webhooks.tsx:175-248` | CAPI 发送 | ✅ 是 |
| `read_script_tags` | 扫描旧版 ScriptTag 用于迁移建议 | `app/services/scanner.server.ts:132-199` | 扫描报告 | ✅ 是 |
| `read_pixels` | 查询已安装的 Web Pixel | `app/services/migration.server.ts:322-352` | 像素状态检测 | ✅ 是 |
| `write_pixels` | 创建/更新 App Pixel extension | `app/services/migration.server.ts:184-250` | 像素安装 | ✅ 是 |

**P0-1 权限调整说明**:
- ~~`write_script_tags`~~：已移除。应用不直接删除 ScriptTag，改为提供手动清理指南。
- 商家需通过 Shopify 后台手动清理旧版 ScriptTag（卸载创建它的应用或联系 Shopify 支持）

**P0-04 验证**: 所有 4 个 scopes 都有明确的代码调用点和业务理由，遵循最小权限原则。

> **Note**: 
> - `read_pixels` 是读取 [WebPixel 对象](https://shopify.dev/docs/api/admin-graphql/latest/objects/WebPixel) 的必需权限
> - `write_pixels` 是 `webPixelCreate` / `webPixelUpdate` mutation 的必需权限

### Test Steps for Reviewers

#### 1. 安装与配置 (5 分钟)
```
1. 从 App Store 安装应用
2. 完成 OAuth 授权
3. 进入应用首页 → 确认无错误提示
4. 进入「设置」页面 → 检查 Ingestion Key 已自动生成 (绿色 Badge)
```

#### 2. 像素激活验证 (3 分钟)
```
1. 进入「迁移」页面
2. 点击「安装 Web Pixel」
3. 确认像素状态变为「已安装」
4. 打开店铺 checkout 页面完成测试订单
```

#### 3. 事件追踪验证 (3 分钟)
```
1. 完成测试订单后等待 30 秒
2. 进入「监控」页面
3. 确认看到订单记录 (Shopify 列)
4. 如已配置平台，确认平台状态显示「已发送」或「待同步」
```

#### 4. GDPR 删除验证 (2 分钟)
```
1. 卸载应用
2. 等待 48 小时（或触发 shop/redact webhook）
3. 确认所有店铺数据被删除
```

### Data Flow Diagram

**P0-02: Only checkout_completed events are sent from pixel to backend.**

```
Customer Browser              Shopify                 Tracking Guardian            Ad Platforms
      │                          │                           │                          │
      │──── Page View ───────────│                           │                          │
      │                          │  (NOT sent to backend)    │                          │
      │                          │                           │                          │
      │──── Product View ────────│                           │                          │
      │                          │  (NOT sent to backend)    │                          │
      │                          │                           │                          │
      │──── Checkout Complete ───│                           │                          │
      │                          │                           │                          │
      │                          │──── checkout_completed ───│                          │
      │                          │    (only event sent)      │                          │
      │                          │    (with consent state)   │                          │
      │                          │                           │                          │
      │                          │──── orders/paid Webhook ──│                          │
      │                          │    (HMAC verified)        │                          │
      │                          │                           │                          │
      │                          │                           │── CAPI (if consented) ──│
      │                          │                           │   (order data only)      │
```

**Privacy Note**: The Web Pixel only subscribes to `checkout_completed`. All other events 
(page_viewed, product_viewed, product_added_to_cart, checkout_started, payment_info_submitted) 
are NOT collected, NOT transmitted, and NOT processed.

---

## P0 优化实施记录 (2025-12-20)

本节记录了针对 Shopify App Store 上架合规和安全性的 P0/P1 级别优化。

### P0-01: 移除商家可配置任意后端 URL

**问题**: 允许商家配置任意 `backend_url` 可能被审核判定为数据外流风险。

**解决方案**:
- 从 `tracking-pixel/shopify.extension.toml` 删除 `backend_url` 设置
- 从 `thank-you-blocks/shopify.extension.toml` 删除 `app_url` 设置
- Extension 代码使用 allowlist 验证，只允许预定义的生产 URL
- 非 allowlist URL 自动回退到生产 URL 常量

**验收**: 商家配置界面不再显示 URL 输入框。

### P0-02: 告警渠道密钥加密存储

**问题**: Slack webhook URL 和 Telegram token 以明文存储在数据库中。

**解决方案**:
- AlertConfig 表新增 `settingsEncrypted` 字段
- 敏感设置 (webhookUrl, botToken) 使用 AES-256-GCM 加密存储
- `settings` 字段仅存储非敏感元数据 (channel, masked values)
- 提供数据迁移脚本 `scripts/migrate-alert-settings.ts`

**验收**: 数据库中搜索不到明文 Slack webhook URL 或 Telegram token。

### P0-03: 生产环境强制签名验证

**改进**: 确认现有实现已满足要求。

### P0-04: 生产环境 Unsigned Pixel Events 硬化

**问题**: 如果 `ALLOW_UNSIGNED_PIXEL_EVENTS=true` 被错误地设置在生产环境，会完全绕过签名验证安全机制。

**解决方案**:
- 在 `app/utils/secrets.ts` 添加 `enforceSecurityChecks()` 函数
- 在 `app/entry.server.tsx` 启动时调用安全检查
- 生产环境下如果设置了 `ALLOW_UNSIGNED_PIXEL_EVENTS=true`，应用会**立即崩溃**并显示错误信息
- `api.pixel-events.tsx` 中的运行时检查作为双重保障

**验收**: 生产环境无法启动带有不安全配置的应用。

### P0-06: App Proxy 路由安全收敛

**问题**: `api.tracking.tsx` 使用 App Proxy 但缺乏用户身份验证，可能导致订单信息枚举。

**解决方案**:
- 默认禁用该端点 (返回 503)
- 需要通过 `ENABLE_TRACKING_API=true` 环境变量启用
- 保留原始实现作为注释，待添加客户身份验证后重新启用

**验收**: 外部用户无法访问订单追踪信息。

### P0-07: 统一 Consent 策略逻辑

**问题**: `retry.server.ts` 中硬编码了平台分类，与 `platform-consent.ts` 存在重复。

**解决方案**:
- 在 `platform-consent.ts` 新增 `getEffectiveConsentCategory()` 函数
- 更新 `evaluatePlatformConsentWithStrategy()` 支持 `treatAsMarketing` 参数
- 修改 `retry.server.ts` 使用统一的 consent 评估函数
- 新增 PixelConfig.clientConfig 读取以支持 Google 的双用途配置

**验收**: 新增平台只需修改 `PLATFORM_CONSENT_CONFIG`，无需修改 retry 逻辑。

### P0-02 & P0-03: 测试增强

**新增测试文件**:
- `tests/pixel/pii-null-regression.test.ts` - PII 为 null 时的回归测试
- `tests/utils/platform-consent.test.ts` - Consent 策略矩阵测试
- `tests/webhooks/gdpr.test.ts` - 增强的 GDPR 合规测试

### P1-02: 日志脱敏增强

**改动**:
- 扩展 `logger.ts` 的敏感字段黑名单 (PII、金融信息、平台密钥)
- 新增 `EXCLUDED_FIELDS` 完全排除大型 payload 字段
- 替换 `api.cron.tsx` 中的 `console.log` 为统一 logger
- 使用 `createRequestLogger` 支持 requestId 追踪

### P1-03: Cron 互斥锁

**问题**: 多实例部署时可能并发执行 cron 任务，导致重复处理。

**解决方案**:
- 新增 `app/utils/cron-lock.ts` 分布式锁实现
- 使用 WebhookLog 表作为锁存储 (避免新增表)
- `withCronLock()` 包装器自动获取和释放锁
- 更新 `api.cron.tsx` 使用锁保护

**验收**: 多实例环境下只有一个实例执行 cron 任务。

---

## P0 优化实施记录 - 第二阶段 (2025-12-21)

本节记录第二阶段的 P0 级别安全和合规优化。

### P0-1: 重新定义"可信请求"模型

**问题**: `isTrusted` 仅基于 ingestion key 匹配，但 ingestion key 可被客户端读取，不是严格的机密。

**解决方案**:
1. **新增 `receipt-trust.ts` 模块** (`app/utils/receipt-trust.ts`):
   - 定义三级信任模型: `trusted` (完全可信), `partial` (部分可信), `untrusted` (不可信)
   - `verifyReceiptTrust()` 函数验证 checkout token 绑定
   - `isSendAllowedByTrust()` 函数基于信任级别和策略决定是否发送

2. **Checkout Token 绑定验证**:
   - Pixel 发送 `checkoutToken` 到后端
   - 后端在处理 ConversionJob 时验证 webhook 的 `checkout_token` 是否匹配
   - 匹配成功才提升到 `trusted` 级别

3. **数据库字段增强** (`PixelEventReceipt`):
   - `trustLevel`: 信任级别 (trusted/partial/untrusted/unknown)
   - `untrustedReason`: 不可信原因
   - `originHost`: 请求来源域名 (审计追踪)

4. **策略集成**:
   - `strict` 模式: 必须 `trusted` 才发送 marketing 平台
   - `balanced` 模式: `partial` 可发送 analytics，marketing 需要 `trusted`
   - ~~`weak` 模式已弃用，不再在 UI 中提供~~

**验收**:
- 伪造的 pixel 事件无法获得 `trusted` 级别
- 没有 checkoutToken 的请求停留在 `partial` 级别
- ConversionJob 记录 `trustMetadata` 供审计

### P0-2: 收紧 Origin/Referrer 校验

**问题**: Origin 验证过于宽松，允许任何 HTTPS 来源。

**解决方案**:
1. **Per-Shop 域名白名单** (数据库):
   - `Shop.storefrontDomains`: 允许的域名列表
   - `Shop.primaryDomain`: 主域名

2. **新增验证函数** (`origin-validation.ts`):
   - `isOriginInAllowlist()`: 验证 origin 是否在白名单中
   - `buildDefaultAllowedDomains()`: 构建默认白名单

3. **Origin 记录**:
   - `PixelEventReceipt.originHost` 记录请求来源
   - 用于安全审计和异常检测

**验收**: 
- 生产环境可配置严格的 origin 白名单
- 所有请求的 origin 被记录用于审计

### P0-3: 强化时间窗与重放防护

**问题**: 可能被重放攻击，同一事件多次提交。

**解决方案**:
1. **Nonce 机制**:
   - 新增 `EventNonce` 表存储短期 nonce
   - Nonce = `orderId:timestamp`，1小时过期
   - 重复 nonce 立即返回 204 (静默丢弃)

2. **时间戳一致性检查**:
   - Header timestamp 与 payload timestamp 对比
   - 过大差异降低信任级别

**验收**:
- 相同事件 1 小时内重复提交被自动去重
- 重放攻击被 nonce 机制阻止

### P0-4: Consent 逻辑可审计化

**问题**: Consent 决策过程不透明，难以审计。

**解决方案**:
1. **ConversionJob 增加审计字段**:
   - `consentEvidence`: 同意证据 (策略、consent state、receipt 状态)
   - `trustMetadata`: 信任验证元数据

2. **日志增强**:
   - 所有 consent 决策记录详细原因
   - 信任验证结果记录到 metrics

**验收**:
- 每个 ConversionJob 都有完整的 consent 和 trust 审计记录
- 可追溯为什么某个事件被发送或跳过

### P0-5: 数据导出 API

**问题**: 商家无法导出自己的数据，不符合 GDPR 数据可携权。

**解决方案**:
新增 `/api/exports` 端点 (`app/routes/api.exports.tsx`):
- 支持导出类型: `conversions`, `audit`, `receipts`, `jobs`
- 支持格式: `csv`, `json`
- 支持日期范围过滤
- 包含字段定义和 PII 标记

**使用示例**:
```
GET /api/exports?type=conversions&format=csv&start_date=2024-01-01
GET /api/exports?type=audit&format=json&include_meta=true
```

**验收**:
- 商家可在 Admin 中导出所有数据
- 导出包含字段说明和 PII 标记

### P1-4: 静默 204 可观测性增强

**问题**: 很多无效请求返回 204，排查困难。

**解决方案**:
1. **增强 metrics** (`logger.ts`):
   - `pixelRejection`: 拒绝原因细分
   - `silentDrop`: 静默丢弃追踪
   - `trustVerification`: 信任验证结果

2. **采样记录**:
   - 高频率拒绝可设置采样率避免日志爆炸
   - 保留指纹用于模式分析 (不含 PII)

**验收**:
- 所有静默 204 都有对应的 metric
- 可通过日志聚合发现异常模式

---

## 数据库迁移说明

### Migration: 20251221000000_p0_storefront_domains

新增字段:
- `Shop.storefrontDomains` (TEXT[]): 允许的店铺域名
- `Shop.primaryDomain` (TEXT): 主域名
- `PixelEventReceipt.trustLevel` (TEXT): 信任级别
- `PixelEventReceipt.untrustedReason` (TEXT): 不可信原因
- `PixelEventReceipt.originHost` (TEXT): 请求来源域名
- `ConversionJob.consentEvidence` (JSONB): 同意证据
- `ConversionJob.trustMetadata` (JSONB): 信任元数据

新增表:
- `EventNonce`: 事件 nonce 用于重放防护

新增索引:
- `PixelEventReceipt.checkoutToken`: 独立索引加速查找

---

## P0 优化实施记录 - 第三阶段 (2025-12-22)

本节记录第三阶段的 P0 级别合规和功能优化。

### P0-1: 移除 checkout_and_accounts_configurations/update Webhook

**问题**: Shopify 已宣布该 webhook 将于 2026-01-01 移除，继续依赖会导致升级状态不再更新。

**解决方案**:
1. **停止订阅** (`shopify.app.toml`):
   - 删除 `checkout_and_accounts_configurations/update` topic 声明
   - 添加注释说明废弃原因

2. **主动清理存量订阅** (`shopify.server.ts`):
   - 新增 `cleanupDeprecatedWebhookSubscriptions()` 函数
   - 在 `afterAuth` hook 中自动执行
   - 查询并删除老店铺的旧 webhook 订阅

3. **保留 Legacy Handler** (`webhooks.tsx`):
   - Handler 标记为 `[DEPRECATED WEBHOOK]`
   - 如果收到事件仍处理，但记录警告

**验收**:
- 新安装店铺不再有该 webhook 订阅
- 老店铺访问应用后自动清理
- 系统不再依赖该 webhook 判断升级状态

### P0-2: 使用 checkoutProfiles + typOspPagesActive 判断升级状态

**问题**: 旧实现使用 webhook 或 `checkoutApiSupported` 推断状态，不够准确。

**解决方案**:
1. **更新 GraphQL 查询** (`checkout-profile.server.ts`):
   ```graphql
   checkoutProfiles(first: 10) {
     nodes { id name isPublished typOspPagesActive }
   }
   ```

2. **计算逻辑**:
   - `typOspPagesEnabled = nodes.some(n => n.isPublished && n.typOspPagesActive)`
   - 这是 Shopify 官方推荐的判断方式

3. **降级处理**:
   - 如果 `typOspPagesActive` 字段不存在，fallback 到 `checkoutApiSupported`
   - 记录 `unknownReason: "FIELD_NOT_AVAILABLE"`

**验收**:
- Plus 且已升级店铺: `typOspPagesEnabled=true`
- Plus 未升级店铺: `typOspPagesEnabled=false`
- 无权限店铺: 返回 `status: "unknown"`, UI 不误报

### P0-3: Cron 刷新升级状态 (使用离线 Token)

**问题**: 原 cron 代码注释说"没有 admin context → 不刷新 typOsp"，导致状态长期停留旧值。

**解决方案**:
1. **新增 `createAdminClientForShop()`** (`shopify.server.ts`):
   - 从 Session 表读取离线 session
   - 解密 accessToken
   - 构造 GraphQL 客户端

2. **新增 `refreshTypOspStatusWithOfflineToken()`** (`checkout-profile.server.ts`):
   - 使用离线 token 调用 checkoutProfiles API
   - 更新数据库中的 `typOspPagesEnabled`

3. **更新 cron 任务** (`api.cron.tsx`):
   - 遍历需要刷新的活跃店铺
   - 调用 `refreshTypOspStatusWithOfflineToken()`
   - 记录 unknown 原因分布 (用于运营监控)

**验收**:
- Cron 跑完后 `typOspUpdates > 0` (对部分店铺)
- 无离线 session 的店铺记录并跳过，不影响整体任务
- 日志输出 unknown reasons 分布

### P0-4: 修复 Pixel Consent 结构性 Bug

**问题**: 
- 初始值读取 `customerPrivacy.marketingAllowed` 而非 `init.customerPrivacy.marketingAllowed`
- 事件更新读取 `event.marketingAllowed` 而非 `event.customerPrivacy.marketingAllowed`

**解决方案** (`extensions/tracking-pixel/src/index.ts`):
1. **初始化**:
   ```typescript
   const initialPrivacyState = init.customerPrivacy;
   marketingAllowed = initialPrivacyState.marketingAllowed === true;
   analyticsAllowed = initialPrivacyState.analyticsProcessingAllowed === true;
   // P0-04: saleOfData 必须显式为 true，undefined/null 视为未授权
   saleOfDataAllowed = initialPrivacyState.saleOfDataAllowed === true;
   ```

2. **订阅事件**:
   ```typescript
   customerPrivacy.subscribe("visitorConsentCollected", (event) => {
     const updatedPrivacy = event.customerPrivacy;
     marketingAllowed = updatedPrivacy.marketingAllowed === true;
     // ...
   });
   ```

**验收**:
- 允许追踪地区: 初始值正确、点击 cookie banner 后状态更新
- 需要同意但未同意: 不发送到后端
- 测试夹具: `tests/pixel/consent-payload-structure.test.ts`

### P0-5: 统一像素声明与发送策略

**问题**: `shopify.extension.toml` 声明 `marketing=true, analytics=true, sale_of_data="enabled"`，
但代码注释说"只要 analyticsAllowed 就发送"——两者自相矛盾。

**解决方案**:
- **采用严格方案**: 保持 toml 声明不变
- **像素端**: 只有当 pixel 被加载时（即所有同意都已授予），才可能发送事件
- **后端**: 按平台分流过滤（marketing 平台需要 marketingAllowed）
- **文档对齐**: 在 toml 和代码中添加详细注释说明策略

**验收**:
- 实际行为与 toml 声明一致
- COMPLIANCE.md 中策略说明可供审核/商家引用

### P0-6: 升级截止日期呈现改进

**问题**: 将 Shopify 的"月份级"公告写成"精确到某日"的承诺（如 2026-01-01）。

**解决方案** (`deprecation-dates.ts`):
1. **区分日期精度**:
   - `DatePrecision`: "exact" | "month" | "quarter"
   - 对于 Shopify 说"August 2025"的，UI 显示"2025年8月起"而非"2025-08-28"

2. **新增显示函数**:
   - `getDateDisplayLabel(date, precision)`: 根据精度返回适当的标签
   - `DEADLINE_METADATA`: 每个截止日期的精度元数据

**验收**:
- UI 文案与帮助中心/官方公告一致
- 不出现"过度精确"的时间承诺

### P0-7: checkoutProfiles 可观测性与降级

**问题**: `checkoutProfiles` 可能报错/无权限，但 UI/扫描输出未解释原因。

**解决方案**:
1. **三态状态**:
   - `TypOspStatus`: "enabled" | "disabled" | "unknown"

2. **Unknown 原因**:
   - `NOT_PLUS`: 非 Plus 店铺
   - `NO_EDITOR_ACCESS`: 无 checkout editor 权限
   - `API_ERROR`: GraphQL 查询失败
   - `RATE_LIMIT`: 限流
   - `NO_PROFILES`: 无 checkout profiles
   - `FIELD_NOT_AVAILABLE`: typOspPagesActive 字段不可用

3. **Cron 统计**: 记录 unknown 原因分布，便于运营定位

**验收**:
- 扫描报告能解释"为什么无法判断"
- Cron 日志输出 `typOspUnknownReasons` 统计

### P0-8: Webhook 处理分支最小化

**问题**: `webhooks.tsx` 存在未注册 topic 的 handler，可能造成混乱。

**解决方案**:
- 在 `default` case 添加明确的警告日志
- 列出当前实际注册的 topics 供参考
- Legacy handler (如 `CHECKOUT_AND_ACCOUNTS_CONFIGURATIONS_UPDATE`) 标记清晰

**验收**:
- 所有 handler 都有对应的注册配置
- 意外 topic 有清晰的日志警告

---

## P1 优化实施记录 - 第三阶段 (2025-12-22)

### P1-3: Consent 平台级规则显式化

**改进** (`platform-consent.ts`):
1. **中心化策略配置**:
   - `PLATFORM_CONSENT_CONFIG` 是唯一配置源
   - 每个平台定义 `requiresSaleOfData` 字段

2. **新增辅助函数**:
   - `getPlatformConsentRequirements()`: 返回平台的同意要求说明
   - `getAllPlatformConsentRequirements()`: 用于文档/调试

**验收**:
- 新增平台只需修改一处配置
- 无需在多处复制 if-else 判断

### P1-6: 官方 Payload 结构测试夹具

**新增测试**:
1. `tests/pixel/consent-payload-structure.test.ts`:
   - 验证 `init.customerPrivacy` 结构解析
   - 验证 `event.customerPrivacy` 结构解析
   - 边界情况和类型强制

2. `tests/services/checkout-profile.test.ts`:
   - 验证 checkoutProfiles API 响应解析
   - 验证 typOspPagesActive 字段处理
   - 错误处理和降级逻辑

**验收**:
- Payload 结构变动时测试先红
- 防止"默默不追踪"的回归

---

*This document is provided for Shopify App Review and merchant transparency.*
