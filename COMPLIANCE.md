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

**P0-02 Compliance: Our Web Pixel ONLY sends checkout_completed events.**

- ❌ Page views (not collected)
- ❌ Product views (not collected)
- ❌ Add to cart events (not collected)
- ❌ Checkout started events (not collected)
- ❌ Customer browsing history (not collected)
- ❌ Device fingerprints
- ❌ IP addresses (except for rate limiting, not stored)
- ❌ Payment information
- ❌ Detailed customer profiles

**Verification**: Check `extensions/tracking-pixel/src/index.ts` - only `checkout_completed` has a subscriber.

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

- **API Authentication**: All API endpoints require valid session
- **Webhook Verification**: HMAC signature validation for all webhooks (Shopify-signed)
- **Pixel Security (P0-03)**: Origin-based validation + rate limiting (NOT client-side HMAC)
  - Ingestion Key is used for request correlation/diagnostics only
  - Security relies on: Origin validation, rate limiting, order verification via webhook
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
| 1.2 | 2025-12 | P0/P1 security and compliance hardening (see below) |

---

---

## App Store Review Checklist

本节提供 Shopify App Store 审核所需的自检清单和测试步骤。

### Pre-Submission Checklist

#### Data Protection Details (Partner Dashboard)
- [ ] 声明收集的数据类型: Order ID, Order Value, Currency, Line Items
- [ ] 声明数据用途: Conversion tracking, Attribution, Reconciliation
- [ ] 声明数据保留期: Configurable 30-365 days
- [ ] 声明数据删除方式: Automatic retention-based + GDPR webhooks
- [ ] 声明第三方分享: Google, Meta, TikTok (仅哈希后的转化数据)

#### Privacy & Security
- [ ] Privacy Policy 链接可访问且内容匹配应用功能
- [ ] Terms of Service 链接可访问
- [ ] Support 联系方式有效
- [ ] 确认 scopes 最小化 (见下方)

#### Scopes Justification (P0-04)
| Scope | 必要性解释 | 代码调用点 | 对应功能 |
|-------|-----------|-----------|---------|
| `read_orders` | 接收 orders/paid webhook 以发送转化事件 | `app/routes/webhooks.tsx:175-248` | CAPI 发送 |
| `read_script_tags` | 扫描旧版 ScriptTag 用于迁移建议 | `app/services/scanner.server.ts:132-199` | 扫描报告 |
| `write_pixels` | 创建/管理 Web Pixel extension | `app/services/migration.server.ts:193-266` | 像素安装 |

**P0-04 验证**: 所有 scopes 都有明确的代码调用点和业务理由。

> **Note**: `read_customer_events` 已移除 - 我们的 App Pixel 直接通过 HTTP 发送数据到后端，不使用 Shopify Customer Events API 读取事件。

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
      │                          │                           │   (hashed PII only)      │
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

*This document is provided for Shopify App Review and merchant transparency.*
