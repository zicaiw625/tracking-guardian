# Tracking Guardian - 合规与数据处理说明

## 概述

Tracking Guardian 是一个 Shopify 应用，作为**数据处理者**（Data Processor）代表商家（数据控制者）处理转化追踪数据。本文档详细说明了应用的数据处理实践、权限使用、合规措施以及第三方共享政策。

**最后更新**: 2025-01-15  
**应用版本**: 1.0.0  
**Shopify API 版本**: 2025-07

---

## 权限说明 (Scopes Justification)

本应用请求以下 Shopify API 权限：

### `read_script_tags`
- **用途**: 扫描店铺中已安装的第三方追踪脚本，帮助商家识别和审计追踪代码
- **数据处理**: 仅读取脚本标签的 URL 和内容，不存储完整的脚本内容
- **保留周期**: 扫描结果保留 30 天

### `read_pixels` / `write_pixels`
- **用途**: 
  - `read_pixels`: 读取店铺配置的 Web Pixel，用于对账和诊断
  - `write_pixels`: 创建和更新 Web Pixel 配置（仅在商家明确授权时）
- **数据处理**: 仅存储像素配置元数据（ID、名称、状态），不存储像素代码内容
- **保留周期**: 配置元数据保留至应用卸载

### `read_customer_events`
- **用途**: 读取客户事件数据，用于转化追踪和事件匹配
- **数据处理**: 仅处理事件元数据（事件类型、时间戳、订单关联），不收集客户个人信息
- **保留周期**: 事件数据保留 7 天

### `read_orders`
- **用途**: 
  - 读取订单数据用于转化追踪（订单 ID、金额、商品信息）
  - 支持 Reorder 功能（需要 PCD 批准）
  - 对账和诊断
- **数据处理**: 
  - **不收集**: 客户姓名、邮箱、电话、地址、支付信息
  - **仅收集**: 订单 ID、订单号、金额、货币、商品信息（名称、数量、价格、SKU）、结账令牌（已哈希）
- **保留周期**: 订单元数据保留 30 天

---

## 数据类型 (Data Types)

### 收集的数据

#### 订单数据
- 订单 ID 和订单号
- 订单金额和货币
- 商品信息（名称、数量、价格、SKU）
- 结账令牌（用于匹配像素事件，已哈希处理）

#### 客户同意状态
- `marketing`: 是否同意营销追踪
- `analytics`: 是否同意分析追踪
- `saleOfData`: 是否允许数据销售（CCPA）

#### 应用配置数据
- 像素配置（平台类型、凭证、启用状态）
- UI 扩展模块配置
- 店铺设置和偏好

#### 诊断和审计数据
- 像素事件收据（用于对账）
- 转化任务执行日志
- Webhook 处理日志

### 不收集的数据（PII）

**我们明确不收集以下个人身份信息：**
- 客户姓名
- 客户邮箱
- 客户电话
- 客户地址
- 支付信息（信用卡号、支付方式详情）

### Protected Customer Data (PCD) 处理

本应用包含需要 Shopify PCD 批准的功能（如 Reorder 模块）。这些功能通过 `PCD_APPROVED` 环境变量控制：

- **默认状态**: `PCD_APPROVED=false`，所有 PCD 相关功能被硬性禁用
- **启用条件**: 仅在获得 Shopify PCD 批准后，通过设置 `PCD_APPROVED=true` 启用
- **门禁机制**: 代码层面实现了硬门禁，未批准时相关 API 端点直接返回 403 错误

---

## 数据保留 (Data Retention)

我们遵循数据最小化原则，仅保存必要的数据，并定期清理过期数据：

所有数据类型的保留周期由店铺的 `dataRetentionDays` 设置控制（默认 90 天）。超过保留期的数据将通过定时任务（Cron）自动清理。

| 数据类型 | 保留周期 | 清理机制 |
|---------|---------|---------|
| ConversionJob（转化任务） | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| PixelEventReceipt（像素收据） | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| ConversionLog（发送日志） | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| ReconciliationReport（对账报告） | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| Webhook 处理日志 | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| 订单元数据 | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| 客户事件数据 | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| AuditLog（审计日志） | 至少 180 天或按店铺 dataRetentionDays（取较大值） | 自动清理 |

所有数据清理通过定时任务（Cron）自动执行，无需人工干预。

---

## 数据删除 (Data Deletion)

我们支持多种数据删除方式，符合 GDPR、CCPA 等隐私法规要求：

### 1. 应用卸载
- **触发**: 收到 `APP_UNINSTALLED` webhook
- **处理**: 卸载时立即标记店铺为 inactive，并在 48 小时内由定时清理任务删除所有与该店铺相关的数据
- **范围**: 包括所有配置、日志、订单数据、像素配置等（通过调用与 `shop/redact` 相同的删除逻辑）

### 2. GDPR 客户数据删除请求
- **触发**: 收到 `CUSTOMERS_DATA_REQUEST` 或 `CUSTOMERS_REDACT` webhook
- **处理**: 
  - `CUSTOMERS_DATA_REQUEST`: 导出客户相关数据（JSON 格式）
  - `CUSTOMERS_REDACT`: 删除客户相关数据（订单、事件、日志）
- **时间**: 收到请求后 30 天内完成

### 3. 店铺数据删除请求
- **触发**: 收到 `SHOP_REDACT` webhook
- **处理**: 删除所有与该店铺相关的数据
- **时间**: 收到请求后 30 天内完成

### 4. 数据主体权利
根据 GDPR 和 CCPA，数据主体享有以下权利：
- **访问权**: 有权了解我们收集了哪些数据
- **删除权**: 有权要求删除数据
- **更正权**: 有权更正不准确的数据
- **数据可携带权**: 有权以结构化格式获取数据
- **反对权**: 有权反对数据处理

所有权利请求通过 Shopify GDPR webhooks 自动处理。

---

## 第三方共享 (Third Party Sharing)

### 服务端转化追踪

当商家启用服务端追踪时，数据可能被发送到以下平台：

#### Meta (Facebook) Conversions API
- **数据类型**: 订单 ID、订单号、金额、货币、商品信息、事件时间戳
- **不发送**: 客户姓名、邮箱、电话、地址、支付信息
- **认证**: 使用商家配置的 Access Token（加密存储）

#### TikTok Events API
- **数据类型**: 订单 ID、订单号、金额、货币、商品信息、事件时间戳
- **不发送**: 客户姓名、邮箱、电话、地址、支付信息
- **认证**: 使用商家配置的 Access Token（加密存储）

#### Google Analytics 4 (GA4) Measurement Protocol
- **数据类型**: 订单 ID、订单号、金额、货币、商品信息、事件时间戳
- **不发送**: 客户姓名、邮箱、电话、地址、支付信息
- **认证**: 使用商家配置的 Measurement ID 和 API Secret（加密存储）

#### 通用 HTTP Webhook
- **数据类型**: 可配置（支持模板自定义）
- **默认数据**: 订单 ID、订单号、金额、货币、商品信息、事件时间戳
- **认证**: 支持 Bearer Token、Basic Auth、自定义 Header
- **安全**: URL 验证（禁止私网地址、DNS 反绑定保护）

### 默认行为

**重要**: 所有新创建的像素配置中，服务端转化追踪（Server-side CAPI/MP）**默认关闭**（`serverSideEnabled: false`）。

只有在设置页面中显式启用后，才会开始发送服务端事件。

启用服务端追踪前，商家必须：
1. 在隐私政策中明确说明向第三方平台发送的数据类型和用途
2. 已获得必要的用户同意（如 GDPR/CCPA 要求）
3. 已准备好应对 Shopify App Review 关于数据使用的询问

### 子处理器

本应用使用以下子处理器：

| 服务提供商 | 用途 | 数据处理位置 | 数据处理协议 |
|----------|------|------------|------------|
| Render.com | 应用托管和基础设施 | 美国/新加坡 | 标准服务协议 |
| PostgreSQL (Render) | 数据存储 | 美国/新加坡 | 数据库即服务协议 |
| Redis (Render) | 缓存和速率限制 | 美国/新加坡 | 缓存服务协议 |

所有子处理器均符合 GDPR 要求，并签署了数据处理协议（DPA）。

---

## 安全措施

### 传输加密
- 所有 API 通信均使用 TLS 1.2+ 加密
- Webhook 端点使用 HMAC 签名验证
- 像素事件使用 HMAC 完整性校验 + 时间窗 + nonce 防重放机制（密钥来自像素 settings，用于完整性与关联，不作为强鉴权）

### 存储加密
- 平台凭证（Access Token、API Secret）使用 AES-256-GCM 加密存储
- 加密密钥使用 scrypt 派生（N=131072, r=8, p=1）
- 所有敏感配置字段均加密存储

### 访问控制
- 通过 Shopify OAuth 验证，确保只有授权的店铺管理员可以访问数据
- 公开端点（Checkout/Customer Account Extensions）使用 Shopify Session Token 验证
- 所有管理操作需要有效的 Shopify 会话

### 日志脱敏
- 所有日志自动脱敏，敏感信息会被替换为 `[REDACTED]`
- 脱敏字段包括：token、secret、email、phone、address 等
- 日志保留周期：90 天（生产环境）

### 防重放攻击
- 像素事件使用 HMAC 完整性校验
- 时间窗验证（10 分钟）
- Nonce 防重放机制（Redis 存储，1 小时过期）
- 订单真实性以 Shopify webhook/后台订单对账为准，像素事件仅用于接收、关联与噪声过滤

### 速率限制
- 像素事件：50 请求/分钟
- Survey：10 请求/分钟
- Tracking API：30 请求/分钟
- Webhook：100 请求/分钟

---

## 合规性

### GDPR 合规
- ✅ 数据处理协议（DPA）就绪
- ✅ 数据主体权利支持（通过 Shopify webhooks）
- ✅ 数据最小化原则
- ✅ 数据保留和删除政策
- ✅ 加密存储和传输

### CCPA 合规
- ✅ 不销售客户数据
- ✅ 支持客户数据删除请求
- ✅ 同意状态管理（saleOfData）

### Shopify App Review 要求
- ✅ 权限使用说明完整
- ✅ 隐私政策公开可访问
- ✅ 数据处理透明
- ✅ PCD 功能硬门禁（未批准时禁用）
- ✅ Shopify 2025-12-10 起对 Web Pixel PII 访问强制执行 protected scopes 要求，已在文档与产品提示中强调

---

## 联系方式

如有任何关于数据处理或隐私的问题，请通过以下方式联系：

- **应用内支持**: 通过 Shopify App 内支持渠道
- **隐私政策页面**: `/privacy`（公开可访问）

---

## 更新历史

- **2025-01-15**: 初始版本

---

## 附录

### 相关文档
- [隐私政策](/privacy) - 面向最终用户的隐私政策页面
- [Shopify App Review 指南](https://shopify.dev/docs/apps/store/requirements)
- [Shopify PCD 要求](https://shopify.dev/docs/apps/store/requirements/protected-customer-data)

### 技术实现
- 加密实现: `app/utils/crypto.server.ts`
- GDPR 处理: `app/webhooks/handlers/gdpr.handler.ts`
- 日志脱敏: `app/utils/logger.server.ts`
- HMAC 验证: `app/lib/pixel-events/hmac-validation.ts`
