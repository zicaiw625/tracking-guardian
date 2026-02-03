# Tracking Guardian - 合规与数据处理说明

## 概述

Tracking Guardian 是一个 Shopify 应用，作为**数据处理者**（Data Processor）代表商家（数据控制者）处理转化追踪数据。本文档详细说明了应用的数据处理实践、权限使用、合规措施以及第三方共享政策。

**最后更新**: 2025-01-15  
**应用版本**: 1.0.0  
**Shopify API 版本**: 2026-01

---

## 权限说明 (Scopes Justification)

本应用请求以下 Shopify API 权限：

### `read_script_tags`
- **用途**: 扫描店铺中已安装的第三方追踪脚本，帮助商家识别和审计追踪代码
- **数据处理**: 仅读取脚本标签的 URL，不存储完整的脚本内容。对于商家手动粘贴的 Additional Scripts，仅在浏览器本地进行分析；原始脚本文本不上传、不进入服务端。仅上传并保存分析结果（指纹、平台类型、风险评分和脱敏摘要，如平台 ID 的后 4 位）。
- **保留周期**: 扫描结果按店铺 dataRetentionDays（默认 90 天）

### `read_pixels` / `write_pixels`
- **用途**: 
  - `read_pixels`: 读取店铺配置的 Web Pixel，用于对账和诊断
  - `write_pixels`: 创建和更新 Web Pixel 配置（仅在商家明确授权时）
- **数据处理**: 仅存储像素配置元数据（ID、名称、状态），不存储像素代码内容
- **保留周期**: 配置元数据保留至应用卸载

---

## 数据类型 (Data Types)

### 收集的数据

#### 像素事件数据
- 事件 ID 和事件类型
- 事件时间戳
- 事件参数（如订单金额、货币、商品信息等，来自 Web Pixel 事件 payload）
- 结账令牌（用于匹配像素事件，已哈希处理）

**注意**：当前版本（v1.0）不通过 Shopify Admin API 读取订单数据。我们仅基于 Web Pixel 上报的事件收据（PixelEventReceipt）进行诊断和统计。

#### 客户同意状态
- `marketing`: 是否同意营销追踪
- `analytics`: 是否同意分析追踪
- `saleOfData`: 是否允许数据销售（CCPA）

#### 应用配置数据
- 像素配置（平台类型、凭证、启用状态）
- UI 扩展模块配置
- 店铺设置和偏好

#### 诊断和审计数据
- 像素事件收据（用于对账和诊断）
- 扫描结果元数据（平台类型、风险评分、指纹等，不包含脚本正文）
- Webhook 处理日志（仅应用生命周期和 GDPR 合规 webhooks）

**重要**：我们不会在数据库内保存任何脚本正文或片段（包括手动粘贴的内容）。对于手动粘贴的脚本，仅在浏览器本地进行分析；原始脚本文本不上传、不进入服务端，仅上传并保存分析结果（指纹、平台类型、风险评分和脱敏摘要）。

#### 请求相关技术数据
- **字段**：IP 地址、User-Agent、page_url、referrer（与请求相关的技术数据）
- **用途**：安全、反作弊与验收目的
- **保留周期**：与店铺 dataRetentionDays 一致（默认 90 天）
- **删除方式**：同 GDPR/webhook 删除策略（CUSTOMERS_REDACT、SHOP_REDACT 等）

#### Session（OAuth/会话存储）
- **可能字段**：`firstName`、`lastName`、`email`（来自 Shopify 在线 Session，仅店铺管理员/员工，非终端客户）
- **用途**：鉴权与会话维持
- **保留**：随 Session 过期或应用卸载
- **删除**：Session 清理、APP_UNINSTALLED / SHOP_REDACT 等既有逻辑

### 不收集的数据（PII）

**我们明确不收集以下个人身份信息：**
- 客户姓名
- 客户邮箱
- 客户电话
- 客户地址
- 支付信息（信用卡号、支付方式详情）

**注意**：为了功能需要（如事件匹配），我们仅在必要时存储不可逆的hash值（如checkoutToken的hash），不存储客户PII明文。

### Protected Customer Data (PCD) 处理

**当前版本（v1.0）不访问 Protected Customer Data (PCD)**。我们不会通过 Shopify Admin API 读取订单数据、客户信息或其他受保护数据。

- **当前 scopes**：`read_script_tags`、`read_pixels`、`write_pixels`
- **不请求的权限**：`read_orders`、`read_customers` 等客户与订单相关权限
- **不订阅订单相关 webhook**：订单 webhook 处理由 `ORDER_WEBHOOK_ENABLED` 门控关闭，避免误入 PCD 路径
- **数据来源**：仅基于 Web Pixel 上报的事件收据（PixelEventReceipt）及验收运行记录（VerificationRun）、扫描报告（ScanReport）等进行诊断和统计

未来版本如需要访问订单数据（如订单层验收、退款对账等），将：
- 在获得 Shopify PCD 批准后才会启用
- 通过 `PCD_APPROVED` 环境变量控制
- 继续遵循"字段最小化"与"用途限定"的原则

**产品承诺**：本应用不依赖客户 PII；即使 Shopify 将 PII 脱敏为 null，核心功能（事件验证、监控、迁移建议）仍可用。

---

## Web Pixel 数据发送说明

### 何时发送
当访客在结账或浏览时触发 Shopify 标准事件（如 checkout_completed、page_viewed、product_viewed、checkout_started 等）时，本应用的 Web Pixel 会向本应用后端发送事件；仅在客户已通过 Customer Privacy API 授予相应同意（analytics 或 marketing，依事件类型）时发送。

### 发送字段
仅发送事件类型、时间戳、店铺域名、以及订单/结账相关非 PII（如 orderId、checkoutToken、金额、货币、商品 ID/数量等）。不包含客户姓名、邮箱、电话、地址等个人身份信息。

### 如何跟随 consent 变化
本 Pixel 声明并依赖 Shopify Customer Privacy API（analytics、marketing）。订阅 visitorConsentCollected 事件；当商户在店铺中更新同意配置或访客更改选择时，Pixel 会更新内部 consent 状态，未同意时对应事件不会发送到后端。

---

## 数据保留 (Data Retention)

我们遵循数据最小化原则，仅保存必要的数据，并定期清理过期数据：

所有数据类型的保留周期由店铺的 `dataRetentionDays` 设置控制（默认 90 天）。超过保留期的数据将通过定时任务（Cron）自动清理。

| 数据类型 | 保留周期 | 清理机制 |
|---------|---------|---------|
| PixelEventReceipt（像素收据） | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| VerificationRun（验收运行） | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| ScanReport（扫描报告） | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| EventLog（事件日志） | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| AuditLog（审计日志） | 至少 180 天或按店铺 dataRetentionDays（取较大值） | 自动清理 |
| WebhookLog（Webhook 处理日志） | 按店铺 dataRetentionDays（默认 90 天） | 自动清理 |
| Session（OAuth） | 随 Session 生命周期 | 过期或卸载时清理 |

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
  - 数据导出中的像素事件收据（pixelEventReceipts）采用最小字段集；若未存储同意状态或可信标记，则 `consentState`、`isTrusted` 不会在导出中提供
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

**重要**：v1 上架版不启用服务端投递；后端不创建、不执行 S2S 投递任务。该功能通过 `SERVER_SIDE_CONVERSIONS_ENABLED` 环境变量控制，默认值为 `false`。v1.0 核心能力为迁移、验收与监控。v1 仅支持 analytics 用途的客户端像素与验收；Meta/TikTok 凭证入口仅为后续 S2S 能力预留，当前版本不向营销平台发送数据。

只有在设置页面中显式启用且 `SERVER_SIDE_CONVERSIONS_ENABLED=true` 时，才会开始发送服务端事件。

启用服务端追踪前，商家必须：
1. 在隐私政策中明确说明向第三方平台发送的数据类型和用途
2. 已获得必要的用户同意（如 GDPR/CCPA 要求）
3. 已准备好应对 Shopify App Review 关于数据使用的询问

### 通知与告警服务（当前版本已禁用）

**当前版本（v1.0）中，告警通知功能已禁用**。以下子处理器仅在将来版本或商家显式启用告警功能时使用：

#### Slack Webhook
- **用途**: 发送告警通知到 Slack 频道
- **发送的数据字段**: 店铺域名、告警类型、聚合指标（订单数、平台转化数、差异率）、应用内报告链接（JSON 格式）
- **不发送**: 客户个人信息（PII）、订单明细、终端客户数据
- **数据处理位置**: 由商家配置的 Slack Workspace 位置决定
- **URL 验证**: 仅允许 `hooks.slack.com` 域名，路径必须为 `/services/` 或 `/triggers/` 开头

#### Telegram Bot API
- **用途**: 发送告警通知到 Telegram 聊天
- **发送的数据字段**: 店铺域名、告警类型、聚合指标（订单数、平台转化数、差异率）
- **不发送**: 客户个人信息（PII）、订单明细、终端客户数据
- **数据处理位置**: 由 Telegram 服务位置决定
- **认证**: 使用商家配置的 Bot Token 和 Chat ID

### 子处理器

本应用使用以下子处理器：

| 服务提供商 | 用途 | 数据处理位置 | 数据处理协议 |
|----------|------|------------|------------|
| Render.com | 应用托管和基础设施 | 美国/新加坡 | 标准服务协议 |
| PostgreSQL (Render) | 数据存储 | 美国/新加坡 | 数据库即服务协议 |
| Redis (Render) | 缓存和速率限制 | 美国/新加坡 | 缓存服务协议 |
| Slack | Webhook 通知（告警通知，当前版本已禁用） | 由商家配置的 Workspace 位置决定 | Webhook 服务协议 |
| Telegram | Bot API 通知（告警通知，当前版本已禁用） | 由 Telegram 服务位置决定 | Bot API 协议 |

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
- 像素事件使用 HMAC 完整性校验（密钥通过 Web Pixel settings 下发到客户端，仅作完整性与抗滥用信号，不作为强鉴权）
- 时间窗验证（10 分钟）
- Nonce 防重放机制（Redis 存储，1 小时过期）
- 订单真实性以 Shopify webhook/后台订单对账为准，像素事件仅用于接收、关联与噪声过滤

### 像素事件信任与隐私策略摘要（可审计）

- **信任模型**：HMAC 作为防滥用与防随机脚本扫接口的门槛，不作为强身份认证。高价值事件（如 Purchase、Refund）的最终可信度依赖服务端可验证信号（receipt、去重、后台对账等），不依赖客户端 HMAC alone。
- **未同意时行为**：未获得必要同意（analytics/marketing 等）时，不向后端发送对应类型事件（deny all）；策略与扩展内 `customerPrivacy` 及 `visitorConsentCollected` 逻辑一致，见 `extensions/tracking-pixel` 与 `extensions/post-checkout-badge` 中相关实现。

### Web Pixel ingestion_key/HMAC 威胁模型

- **设计定位**：`ingestion_key` 是**完整性校验令牌 (Integrity Token)**，用于事件完整性校验、抗滥用信号与店铺关联，**不作为强鉴权凭证**；密钥会随 Web Pixel settings 下发到客户端运行环境。真正的安全由 webhook/订单对账与整体架构设计提供。
- **可以防护/缓解的风险**：
  - 随机伪造请求、无密钥脚本刷量
  - 请求内容被篡改（HMAC 完整性）
  - 重放攻击（时间窗 + nonce）
  - 基于来源的异常放大（Origin 校验 + 速率限制）
- **不防护/不承诺的能力**：
  - 具备较强能力的攻击者从客户端环境提取密钥后进行伪造
  - 店主级/扩展运行环境可观测条件下的对抗性伪造
  - 将 `ingestion_key` 作为用户身份认证或授权凭证
- **降级与隔离策略**：
  - 事件在接收与处理链路中使用信任分级（`trusted/partial/untrusted`）并据此决定后续投递策略
  - 对关键事件（如 `checkout_completed`）在服务端进行二次校验（Shopify Admin API 订单存在性与金额一致性），校验失败会降低信任并阻止高价值投递
  - 密钥轮换支持短暂兼容窗口（grace window）以减少配置切换导致的事件丢失
- **多层防护机制**：
  - Origin 允许列表/解析回退策略
  - IP/店铺维度速率限制
  - 请求体大小限制
  - 时间窗与 nonce 重放保护
- **监控与告警**：
  - HMAC 失败率、nonce 重放率、null/missing Origin 峰值、异常流量模式
  - 关键事件二次校验失败率与投递失败率

### ingestion_key 弱秘密处理与泄露处置

**重要说明**：`ingestion_key` 是**弱秘密**，会随 Web Pixel settings 下发到客户端运行环境，任何下发到客户端的密钥都有被提取的风险。这是客户端安全模型的固有限制。

**定期轮换建议**：
- 建议每 90 天轮换一次 `ingestion_key`
- 系统支持密钥轮换机制，轮换后旧密钥有 30 分钟过渡期（grace window），确保平滑过渡
- 轮换后系统会自动同步新密钥到 Web Pixel 配置

**泄露处置流程**（一旦发现异常流量或怀疑密钥泄露）：
1. **立即轮换密钥**：在设置页面使用"更换令牌"功能立即生成新密钥
2. **收紧 allowlist**：检查并更新 Origin 允许列表，移除可疑域名
3. **拉高限流**：临时提高速率限制阈值，防止滥用
4. **检查事件日志**：审查访问记录，识别异常请求模式
5. **监控后续流量**：轮换后持续监控事件接收情况，确认新密钥正常工作

**运维 Runbook 要点**：
- 将"key 可能泄露"的风险写进运维手册
- 建立密钥轮换操作流程和审计记录
- 定期检查 HMAC 失败率和异常流量模式
- 在监控面板中设置告警阈值，及时发现可疑活动

### 速率限制
- 像素事件：50 请求/分钟
- Survey：10 请求/分钟
- Tracking API：30 请求/分钟
- Webhook：100 请求/分钟

---

## Web Pixel 隐私处理

### Customer Privacy 合规

本应用严格遵循 Shopify 的 Web Pixel Customer Privacy 要求，确保在需要用户同意的地区（如 GDPR、CCPA 等）正确处理隐私信号。

#### 平台层保护

Shopify 平台在需要 consent 的地区会自动：
- 延迟执行像素回调，直到用户提供必要的同意
- 在用户同意后回放（replay）之前被延迟的事件
- 根据用户的同意状态（marketing、analytics、saleOfData）过滤事件

#### 应用层保护

本应用在像素端实现了额外的隐私保护机制（双保险）：
- 使用 `init.customerPrivacy` API 获取客户隐私状态
- 订阅 `visitorConsentCollected` 事件，实时响应同意状态变化
- 在未获得必要同意时，默认拒绝所有追踪事件（deny all）
- 仅在获得明确同意后才处理相应类型的事件

#### 事件回放处理

当 Shopify 平台回放延迟的事件时：
- 本应用会正常接收并处理这些回放事件
- 事件的时间戳保持原始值，确保数据准确性
- 所有回放事件同样经过 HMAC 验证、时间窗检查、nonce 防重放等安全机制

#### 同意状态管理

本应用支持以下同意类型：
- **marketing**: 营销追踪同意
- **analytics**: 分析追踪同意
- **saleOfData**: 数据销售同意（CCPA）

像素事件会根据这些同意状态进行过滤，确保只处理用户已同意的数据类型。

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

## PCD 申请材料要点

以下内容供在 Partner Dashboard 提交 PCD 申请时填表或附件引用，代码中已有对应实现：

- **数据最小化**：不取姓名、邮箱、电话、地址、支付信息；仅订单 ID、订单号、金额、货币、商品信息（名称、数量、价格、SKU）、结账令牌（已哈希）。
- **存储与传输**：平台凭证 AES-256-GCM 加密；日志脱敏；TLS 1.2+。
- **保留期**：由店铺 `dataRetentionDays` 控制，默认 90 天；定时任务自动清理。
- **门禁**：`PCD_APPROVED` 未批准时，Reorder 等 PCD 功能在 API 层直接返回 403；相关 UI 禁用。

---

## 联系方式

如有任何关于数据处理或隐私的问题，请通过以下方式联系：

- **应用内支持**: 通过 Shopify App 内支持渠道
- **隐私政策页面**: `/privacy`（公开可访问）

---

## 更新历史

- **2025-01-15**: 初始版本

---

## API 鉴权方式矩阵表

本应用使用多种鉴权方式，根据不同的 API 端点和访问场景选择合适的鉴权机制：

| API 端点类型 | 鉴权方式 | 实现位置 | 需要 Header | 错误码约定 | 说明 |
|------------|---------|---------|------------|-----------|------|
| **Admin app API** | `authenticate.admin(request)` | `app/lib/route-handler.ts` | `Authorization: Bearer <session_token>` (前端自动添加) | `401: AUTH_INVALID_TOKEN` | 依赖请求上下文，使用 Shopify session token 验证。前端通过 Remix/App Bridge 等自动添加 session token。 |
| **Public extension API** | `authenticate.public.checkout()` 或 `authenticate.public.customerAccount()` | `app/utils/public-auth.ts` | `Authorization: Bearer <session_token>` | `401: Unauthorized` | 使用 Shopify session token，适用于 Checkout 和 Customer Account UI extensions。 |
| **Ingest API** (`/ingest`) | HMAC + timestamp + origin + nonce | `app/routes/ingest.tsx` | `X-Tracking-Guardian-Signature`, `X-Tracking-Guardian-Timestamp` | `401: Invalid request` | 使用 `ingestion_key` 进行 HMAC 完整性校验，配合时间窗、origin 校验和 nonce 防重放。 |
| **Webhook** (`/webhooks`) | HMAC 签名验证 (raw body) | `app/routes/webhooks.tsx` | `X-Shopify-Hmac-Sha256` | `401: Unauthorized: Invalid HMAC` | Shopify 官方 HMAC 验证，必须使用 raw body，禁止提前消费 body 的中间件。 |

### 鉴权方式说明

**Admin app API**：
- 所有 `/app/*` 路由和 `/api/*` 路由（除已明确 public 的）都使用 `authenticate.admin(request)`
- 前端通过 Remix/App Bridge 等自动获取并添加 session token
- 服务端通过 `createActionHandler` 或 `createLoaderHandler` 统一处理鉴权

**Public extension API**：
- 适用于 Checkout UI Extension 和 Customer Account UI Extension
- 使用 `authenticate.public.checkout()` 或 `authenticate.public.customerAccount()` 验证 session token
- 前端通过 `api.sessionToken.get()` 获取 token 并添加到请求头

**Ingest API**：
- 使用 `ingestion_key` 进行 HMAC 完整性校验
- 支持时间窗验证（10 分钟）、origin 校验、nonce 防重放
- `ingestion_key` 是弱秘密，会下发到客户端，主要用于完整性校验和抗滥用信号

**Webhook**：
- 使用 Shopify 官方 HMAC 验证机制
- 必须使用 raw body 进行验证，禁止任何会提前消费 body 的中间件
- 支持 idempotency lock 防止重复处理

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
