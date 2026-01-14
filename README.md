# Tracking Guardian

**Shopify 升级迁移交付平台** - 帮助商家在 Shopify Checkout Extensibility 升级截止日前，安全迁移追踪脚本和页面功能，提供可交付的验收报告和断档监控。

## 🎯 产品定位

**升级迁移交付平台** - 帮助商家在 Shopify Checkout Extensibility 升级截止日前，安全迁移追踪脚本和页面功能

### 我们的确定性来自 Shopify 的硬 deadline

- **Plus 店铺**：从 **2026-01 开始自动升级**（legacy 定制会丢失）
- **非 Plus 店铺**：最晚 **2026-08-26** 必须完成升级
- Legacy 的 `checkout.liquid`、`additional scripts`、`script tags` 会逐步被 sunset

### v1 的核心承诺（不是"我帮你追踪效果提升"，而是）

✅ **升级不丢功能/不丢数据**（在 Shopify 允许范围内）  
✅ **给你一份"可交付的验收报告"**（PDF/CSV，给老板/客户看的证据）  
✅ **上线后有断档告警**（事件量骤降、失败率监控）

### 核心价值主张

避开直接硬刚 Elevar/Littledata（他们价位与预期都更高，$99+/月），专注于让商家**"敢点发布/敢切 Live"**的核心能力。

**产品卖点话术**：
- "替换 Additional Scripts，减少结账页脚本风险"
- "基于 Web Pixels + Customer Accounts UI Extensions 的合规迁移"
- "验收报告 + 断档告警（给老板/客户看的证据）"

## v1 MVP 核心功能（付费理由非常硬）

### (A) 免费：Audit 风险报告（必须强）
- **自动扫描**：通过 Shopify API 读取已安装的 ScriptTags 和 Web Pixels
- **手动分析**：支持手动粘贴 Additional Scripts 内容进行分析
  - ⚠️ **注意**：Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts，需要商家手动复制粘贴
- **迁移清单**：生成完整的迁移清单，包含每个待迁移项
- **风险分级**：基于风险等级、影响范围、迁移难度进行分级（高/中/低）
- **替代路径**：明确标注每个迁移项的替代路径（Web Pixel / Checkout UI Extension / 不可迁移）
- **截止日期提醒**：根据店铺类型（Plus/非Plus）显示 Shopify 官方截止日期
  - Plus 店铺：2026-01 开始自动升级
  - 非 Plus 店铺：最晚 2026-08-26
- **可分享报告链接**：免费用户可查看和分享报告链接，但导出功能需付费

### (B) 付费：像素"最小可用迁移"（标准事件映射 + 参数完整率）
- **支持的平台**（v1 只做这3个）：
  - Google Analytics 4 (GA4)
  - Meta (Facebook) Pixel
  - TikTok Pixel
- **标准事件映射**：自动映射标准电商事件（purchase、view_item、add_to_cart 等）
- **参数完整率检查**：验证事件参数（value、currency、items 等）的完整性
- **可下载 payload 证据**：支持下载事件 payload，用于验证和存档
- **Test/Live 环境切换**：支持测试环境验证后再发布到生产环境
- **事件流预览**：实时预览事件触发情况

> **技术说明**：Web Pixel 运行在严格沙箱（Web Worker）环境中，很多能力受限。我们会明确告知限制，并提供可行的替代方案。

### (C) 付费：Thank you / Order status 模块库（v1 包含 3 个核心模块）
- **Post-purchase Survey（购后问卷）**：收集客户反馈，了解获客渠道（官方示例场景，有强差异化）
- **Help & Support 模块（帮助中心/联系客服）**：迁移替代件、配置简单，包含 FAQ、联系客服、继续购物等功能
- **Reorder（再购按钮）**：一键重新购买相同商品，仅在 Customer Accounts 的 Order status 页面可用（需要客户账户认证，不支持旧版订单状态页）

> **⚠️ 重要提示：Order Status 模块仅支持 Customer Accounts 体系**
> 
> Order Status 模块使用 `customer-account.order-status.block.render` target，仅适用于 Customer Accounts 体系下的订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），Order Status 模块将不会显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
> 
> 请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。如果未启用，请先在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，然后才能使用 Order status 模块。
> 
> **文档引用说明（避免误导）**：
> 
> 请参考 [Customer Accounts UI Extensions](https://shopify.dev/docs/apps/customer-accounts/ui-extensions) 官方文档。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。

> **v1.1 以后规划**：以下模块在 v1 中**不可用**（代码中已标记为 disabled），将在后续版本发布：
> - Order Tracking（物流追踪）- 需深集成，API/适配会膨胀
> - Upsell Offer（追加销售）- 边界条件复杂
> 
> **注意**：Reorder 模块需要 Protected Customer Data (PCD) 访问权限。PCD 功能需要 Shopify 审核批准，默认禁用。获得批准后可在设置中启用。

### (D) 付费：验收（Verification）+ 断档监控（Monitoring）
这是产品的"交付件"，也是 Agency 愿意付钱的关键。

- **验收功能**：
  - 测试清单：生成完整的测试清单
  - 事件触发记录：实时记录事件触发情况
  - 参数完整率：检查事件参数的完整性
  - 订单一致性：验证事件金额/币种与 Shopify 订单的一致性
  - 隐私合规检查：验证像素是否尊重 consent / customerPrivacy
  
  > **⚠️ v1.0 验收范围说明**：
  > - ✅ **支持的事件类型**：checkout_started、checkout_completed、checkout_contact_info_submitted、checkout_shipping_info_submitted、payment_info_submitted、product_added_to_cart、product_viewed、page_viewed 等 Web Pixels 标准 checkout 漏斗事件
  > - ❌ **不支持的事件类型**：退款（refund）、订单取消（cancel）、订单编辑（order_edit）、订阅订单（subscription）等事件在 v1.0 中不可验收
  > - **原因**：Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件。退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取，将在 v1.1+ 版本中通过订单 webhooks 实现（严格做 PII 最小化）
- **监控功能**：
  - 事件量骤降检测：监控事件量的异常下降
  - 失败率阈值告警：当失败率超过阈值时告警
  - Purchase 缺参率监控：监控 purchase 事件关键参数的缺失率
  - 多渠道告警：支持邮件/Slack/Telegram 告警

## 服务器端转化追踪（Server-side CAPI/MP）

v1.0 版本**已包含**服务器端转化追踪能力，支持以下平台：
- Meta Conversions API (CAPI)
- GA4 Measurement Protocol
- TikTok Events API

**功能说明**：
- 支持客户端/服务端混合去重（hybrid mode）
- 事件通过服务端 API 直接发送到广告平台，提高数据可靠性
- 支持 Test/Live 环境切换
- 完整的发送状态记录和错误处理

**配置方式**：在「设置」页面的「服务端追踪」标签页中配置平台凭证。

## 未来版本规划（v1 暂不包含）

### 深集成功能
- ⚠️ **v1 暂不包含**：
  - AfterShip/17Track 等物流追踪集成（API/适配会膨胀）
  - 其他第三方服务深度集成

### 其他 UI 模块
- ⚠️ **v1 暂不包含**：
  - Shipping Tracker（物流追踪）- 需深集成，v1.1+
  - Upsell Offer（二次购买优惠）- 边界条件复杂，v1.1+
  - Reorder（再购按钮）- 集成复杂，v1.1+

## Agency 多店支持（高阶套餐）
- **多店工作区**：创建和管理多个店铺分组
- **批量 Audit 扫描**：批量运行扫描，跟踪进度和结果汇总
- **批量应用像素模板**：一键将配置应用到多个店铺
- **迁移验收报告导出**：生成多店铺迁移报告（PDF/CSV），包含每个店铺的迁移状态和进度统计
- **白标报告支持**：支持自定义品牌（Agency 品牌）

### 套餐与定价（迁移交付导向）

市场参照：成熟 tracking 工具普遍 $99+/月甚至更高。我们 $29/$79/$199 的优势是"迁移助手 + 验收交付"，定价表达这个价值。

| 套餐 | 定价 | 适用场景 | 核心能力 |
| --- | --- | --- | --- |
| **Free** | $0 | 扫描、评估阶段 | Audit 扫描报告（可分享链接，但**不导出**）、迁移清单与建议、风险分级与替代路径、截止日期提醒 |
| **Starter** | **$29/月** | 像素迁移阶段 | 1 个像素目的地（GA4 或 Meta 或 TikTok 三选一）、Survey 或 Helpdesk 二选一、验收向导（**不含报告导出**）、标准事件映射 + 参数完整率、可下载 payload 证据、Test/Live 环境切换 |
| **Growth** | **$79/月** | 项目交付阶段 | 像素迁移 + 模块发布 + **验收报告导出（PDF/CSV）** - 目标是"Agency 直接报给客户的交付包"、事件参数完整率检查、订单金额/币种一致性验证、隐私合规检查、每月 10,000 笔订单追踪 |
| **Agency** | **$199/月** | 多店代理/协作 | 多店铺 workspace + 批量 Audit + 批量导出报告 + 团队协作、白标报告支持、专属客户成功经理、SLA 保障、每月 100,000 笔订单追踪 |

> **注意**：Monitor 计划（$29/月，可选叠加）不在 v1.0 正式套餐列表中，将在后续版本中提供。

> **付费墙设计原则**：把"看报告"做免费，把"导出报告/分享给客户"做付费，非常适合 Agency 场景。
> 
> **付费触发点**（3个强 CTA，直接对应商家的"升级项目交付"）：
> 1. **启用像素迁移（Test 环境）** → 进入付费试用/订阅（Starter $29/月）
> 2. **发布 Thank you/Order status 模块** → 进入付费（Starter $29/月）
> 3. **生成验收报告（PDF/CSV）** → 付费（Growth $79/月）
>
> 权限/功能 gating 已在前端页面展示：升级 CTA 位于仪表盘与迁移页；默认 plan 为 Free。

## 技术栈

- **框架**: Remix + Shopify App Remix
- **UI**: Shopify Polaris
- **数据库**: PostgreSQL + Prisma ORM
- **扩展**: Web Pixel Extension + Checkout UI Extension

## 快速开始

### 前置要求

- Node.js 22.18+ (required for running TypeScript utility scripts directly; `.nvmrc` pins 22.18.0 to avoid strip-types runtime mismatches)
- PostgreSQL 数据库
- Shopify Partner 账号
- Shopify CLI

### 安装步骤

1. **克隆项目并安装依赖**

```bash
cd "Post-purchase Tracking Guardian"
pnpm install
```

> 项目已统一使用 **pnpm**，CI 也仅支持 pnpm。Yarn（含 Yarn PnP）已移除且不再支持，务必避免提交 `.pnp.*` 或 `.yarn/` 等文件。

> 仓库已包含 `pnpm-lock.yaml`，在 CI 或部署环境请使用 `pnpm install --frozen-lockfile` 确保依赖锁定。当前锁文件基于本地缓存生成，如需完全同步官方 registry，请在可访问 npm registry 的环境重新运行 `pnpm install --lockfile-only` / `pnpm install` 并提交更新后的锁文件。

2. **配置环境变量**

创建 `.env` 文件：

```env
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
# v1.0 默认最小权限（订单查询能力为可选扩展）
SCOPES=read_script_tags,read_pixels,write_pixels,read_customer_events
SHOPIFY_APP_URL=https://your-app-url.com
DATABASE_URL=postgresql://user:password@localhost:5432/tracking_guardian

# P0-2: Web Pixel Origin null 兼容配置（生产环境必须设置）
# Shopify web pixel / customer events 在沙箱里经常出现 Origin: null
# 生产环境必须设置此变量为 true，否则会拦截掉真实事件
PIXEL_ALLOW_NULL_ORIGIN=true

# 可选：安全相关环境变量
CRON_SECRET=your_cron_secret_min_32_chars  # 用于 cron job 鉴权
ENCRYPTION_SECRET=your_encryption_secret_min_32_chars  # 用于数据加密
```

3. **初始化数据库**

```bash
pnpm generate
pnpm db:deploy
```

4. **启动开发服务器**

```bash
pnpm dev
```

### 部署

#### Render 部署（推荐 - 免费数据库）

项目包含 `render.yaml` Blueprint 文件，支持一键部署：

1. 推送代码到 GitHub
2. 在 [Render](https://render.com) 创建 Blueprint
3. 连接仓库，自动创建数据库和 Web 服务
4. 设置 Shopify API 环境变量

**重要配置说明**：
- `PIXEL_ALLOW_NULL_ORIGIN` 已在 `render.yaml` 中自动设置为 `true`，确保 Web Pixel 事件能正常接收
- Cron Job 服务已自动配置，请确保在 Render Dashboard 中为 cron job 设置以下环境变量（从 web service 复制）：
  - `CRON_SECRET`（必须与 web service 相同）
  - `SHOPIFY_APP_URL`（web service 的完整 URL）

详细步骤请参考 [SETUP.md](SETUP.md)

#### Vercel 部署

1. 连接 GitHub 仓库到 Vercel
2. 配置环境变量（需要外部数据库如 Neon）
3. 部署完成后更新 Shopify App URL

#### Railway 部署

```bash
railway login
railway init
railway add
railway up
```

## 项目结构

```
├── app/
│   ├── routes/
│   │   ├── app._index.tsx      # 仪表盘首页
│   │   ├── app.scan.tsx        # 扫描报告
│   │   ├── app.migrate.tsx     # 迁移工具
│   │   ├── app.monitor.tsx     # 监控面板
│   │   ├── app.settings.tsx    # 设置
│   │   └── webhooks.tsx        # Webhook 处理
│   ├── services/
│   │   ├── scanner.server.ts       # 扫描服务
│   │   ├── migration.server.ts     # 迁移服务
│   │   ├── delivery-health.server.ts # 发送健康检查
│   │   ├── notification.server.ts  # 通知服务
│   │   ├── retry.server.ts         # 重试队列服务
│   │   └── platforms/              # 广告平台集成
│   └── db.server.ts            # Prisma 客户端
├── extensions/
│   ├── tracking-pixel/         # Web Pixel Extension
│   └── thank-you-blocks/       # Checkout UI Extension
├── prisma/
│   └── schema.prisma           # 数据库模型
└── package.json
```

## API 权限说明（P0-3: 最小权限）

| 权限 | 用途 | 代码调用点 | 首次安装必需? | 隐私承诺 |
|------|------|-----------|--------------|---------|
| `read_script_tags` | 扫描旧版 ScriptTags 用于迁移建议 | `scanner.server.ts` | ✅ 是 |
| `read_pixels` | 查询已安装的 Web Pixel 状态 | `migration.server.ts` | ✅ 是 |
| `write_pixels` | 创建/更新 App Pixel Extension | `migration.server.ts` | ✅ 是 |
| `read_customer_events` | （未来）事件对账/同意状态补充 | `app.migrate.tsx` 授权检测 | ⚠️ 场景化 |

**P0-3 说明**：v1.0 默认不申请 `read_orders`，保持最小权限。订单信息查询仅作为可选扩展能力，需要商家单独授权时再开启。

### API 端点说明

**像素事件接收端点**：

- **唯一端点**：`POST /ingest`
  - PRD 8.2 定义的批量事件接口，唯一推荐使用的端点
  - 支持批量格式：`{ events: [event1, event2, ...], timestamp: number }`
  - 同时支持单事件格式（向后兼容）
  - 支持 CORS、HMAC 验证、时间窗校验、nonce 防重放等安全机制
  - Web Pixel Extension 已实现批量发送到 `/ingest` 端点，符合 PRD 性能目标
  - **审计结论对齐**：接口形态与 PRD 8.2 完全一致，解决了"Ingest API 形态不一致"问题
  
- **重要说明**：
  - **`/ingest` 是唯一的事件接收入口**，不存在其他接收端点
  - `app/routes/api.pixel-events/` 目录仅包含共享的工具函数（cors、validation、hmac-validation 等），不是独立的路由端点
  - 所有像素事件必须发送到 `POST /ingest`，不要使用其他路径
  - 对外文档和第三方集成必须使用 `POST /ingest`（符合 PRD 8.2）
  - Web Pixel Extension 使用批量格式发送到 `/ingest` 端点，提高性能
  - 批量格式支持最多 100 个事件，自动批处理提高并发处理能力
  - 单事件格式和批量格式都在 `/ingest` 端点中统一处理
  - 详细实现见 `app/routes/ingest.tsx`

**配置获取**：
- 端点 URL 可通过 `app/utils/config.ts` 中的 `getPixelEventEndpoint()` 函数获取
- 支持环境变量配置（开发/生产环境）

### P0-1: ScriptTag 权限说明

**重要提示**：应用**不请求 `write_script_tags` 权限**。

ScriptTag 清理需要商家手动操作：
1. **扫描检测**：识别店铺中已存在的旧版追踪脚本
2. **迁移建议**：生成从 ScriptTag 迁移到 Web Pixel 的建议
3. **手动清理指南**：提供清理 ScriptTag 的详细步骤

**我们不会**：
- ❌ 创建新的 ScriptTag
- ❌ 直接删除 ScriptTag（需商家手动操作）
- ❌ 在 TYP/OSP 页面注入任何客户端脚本

所有追踪功能通过 **Web Pixel Extension**（服务端）和 **Webhooks**（CAPI）实现。

### P0-3: 最小权限说明

- 所有 scopes 都有明确的代码调用点和业务理由
- 详细权限说明请参阅 [COMPLIANCE.md](COMPLIANCE.md) 中的 "Scopes Justification" 部分

## Webhook 订阅

### 应用生命周期
- `app/uninstalled` - 应用卸载时清理数据

### GDPR 合规 Webhook（自动处理）
- `customers/data_request` - 客户数据导出请求
- `customers/redact` - 客户数据删除请求
- `shop/redact` - 店铺数据完全删除

### 订单与退款 Webhook（v1.1+ 功能）
以下 webhooks 将在 v1.1+ 版本中启用，用于事件对账和验收验证：

- `orders/create` - 订单创建时记录订单摘要（用于对账）
- `orders/updated` - 订单更新时同步状态（用于对账）
- `orders/cancelled` - 订单取消时同步状态（用于对账）
- `orders/edited` - 订单编辑时同步状态（用于对账）
- `refunds/create` - 退款创建时同步状态（用于对账）

**v1.0 说明**：
- v1.0 版本仅订阅 `app/uninstalled` 和 GDPR 合规 webhooks，保持最小订阅范围
- 订单和退款相关 webhooks 将在 v1.1+ 版本中启用，用于增强验收验证和对账功能
- 代码中已实现相关处理器，但 `shopify.app.toml` 中暂未订阅，符合 v1.0 最小权限原则

## Built for Shopify (BFS) 特性

### 上架与 BFS 策略

* **替换 Additional Scripts，减少结账页脚本风险** - 基于 Web Pixels + Customer Accounts UI Extensions 的合规迁移
* **验收报告 + 断档告警** - 给老板/客户看的证据
* **性能优化** - 符合 BFS LCP/CLS/INP 指标要求（LCP ≤2.5s、CLS ≤0.1、INP ≤200ms）

### 合规与平台要求

- **GraphQL Admin API**：所有 Admin 操作（WebPixel 创建/删除、checkoutProfiles 查询等）均使用 GraphQL，符合 2025-04-01 起新提交公共应用必须使用 GraphQL Admin API 的要求。代码参考：`app/services/admin-mutations.server.ts`、`app/services/checkout-profile.server.ts`。
- **隐私与最小权限**：
  - **默认事件收集模式（purchase_only）**：仅收集 `checkout_completed` 事件，符合隐私最小化原则
  - **可选全漏斗模式（full_funnel）**：商家可显式启用以收集更多事件（page_viewed, product_viewed, add_to_cart, checkout_started）
  - 默认严格同意策略；PCD 功能需显式开启且数据即时哈希、不落库；权限表见上
- **上线检查**：健康度评分基于近 7 日对账差异率；监控页记录像素心跳来源与送达率，便于自检 BFS 可靠性指标。

### 性能优化

- **最小化 API 调用**：批量处理订单数据，避免不必要的轮询
- **智能缓存**：使用内存缓存减少重复数据库查询
- **懒加载**：按需加载扫描历史和监控数据
- **减少脚本负载**：替换 Additional Scripts，使用 Web Pixels（Web Worker 沙箱环境）

### 稳定性保障

- **断路器模式**：防止级联故障，自动熔断和恢复
- **智能重试**：带指数退避的重试机制，处理临时错误
- **Dead Letter Queue**：失败任务自动进入死信队列，支持手动恢复
- **优雅降级**：平台 API 不可用时保留事件数据等待重试

### 安全与合规

- **最小权限原则**：仅请求必需的 API 权限
- **数据加密**：所有敏感凭证使用 AES-256-GCM 加密存储
- **隐私策略**：可配置的 consent 策略（严格/平衡模式）
- **数据保留**：可配置的数据保留期限（30-365天）
- **审计日志**：所有敏感操作均记录审计日志

#### 上线前安全压测建议（必须执行）

为确保生产环境稳定性，**必须在正式上线前执行以下压测**。这些测试是上线前的关键验证步骤，避免在生产环境高峰期出现事件丢失或服务不可用。

1. **高并发下单/事件峰值测试（上线前必须执行）**
   - **测试目标**：模拟黑五等高峰期的下单场景（建议峰值：100-1000 订单/分钟）
   - **验证内容**：
     - 验证 rate limit 配置是否会导致误杀正常请求
     - 检查事件队列处理能力和延迟情况
     - 监控数据库连接池和 API 调用频率
     - 验证事件处理吞吐量和响应时间
   - **重点验证**：rate limit 阈值是否合理，避免在高并发场景下误杀正常请求。建议根据实际业务峰值调整 `RATE_LIMIT_CONFIG.PIXEL_EVENTS` 配置。如果压测中发现误杀，需要调整 `app/utils/rate-limiter.ts` 中的 `pixel-events` 配置。
   - **实战建议**：使用项目内置压测脚本 `scripts/load-test-pixel-ingestion.mjs` 进行测试，建议在测试环境先验证，确认无误后再部署到生产环境。
   - **执行命令**：
     ```bash
     # 高并发压测（50并发，持续60秒）
     CONCURRENT_REQUESTS=50 DURATION=60 node scripts/load-test-pixel-ingestion.mjs
     
     # 峰值压测（100并发，持续120秒）
     CONCURRENT_REQUESTS=100 DURATION=120 node scripts/load-test-pixel-ingestion.mjs
     ```
   - **验收标准**：
     - 无 rate limit 误杀（所有正常请求应成功）
     - 事件处理延迟 < 2秒（P95）
     - 错误率 < 0.1%
     - 数据库连接池无耗尽

2. **Origin: null 场景测试（上线前必须执行）**
   - **测试目标**：验证 Web Pixel 在沙箱环境中发送事件时 Origin 为 null 的情况
   - **验证内容**：
     - 验证 `PIXEL_ALLOW_NULL_ORIGIN=true` 环境变量已正确设置（生产环境必须设置）
     - 确认事件仍能正常接收和处理（不因 Origin 校验失败而丢失）
     - 检查日志中 Origin: null 的请求是否被正确标记和允许
   - **重点验证**：某些 Shopify 场景（如 Web Worker 沙箱环境）可能出现 `Origin: null`，生产环境默认会拒绝此类请求。必须设置 `PIXEL_ALLOW_NULL_ORIGIN=true` 才能正常接收事件。如果未设置此环境变量，像素事件将在 Origin: null 场景下被拒绝，导致事件丢失。
   - **实战建议**：使用压测脚本的 `--null-origin-only` 参数专门测试 Origin: null 场景，确保生产环境配置正确。
   - **执行命令**：
     ```bash
     # 仅测试 Origin: null 场景
     node scripts/load-test-pixel-ingestion.mjs --null-origin-only
     
     # 验证环境变量已设置
     echo $PIXEL_ALLOW_NULL_ORIGIN
     ```
   - **验收标准**：
     - 所有 Origin: null 请求应成功处理
     - 无事件丢失
     - 日志中正确标记 Origin: null 请求

**压测工具建议**：
- 使用项目内置的压测脚本：`node scripts/load-test-pixel-ingestion.mjs`（推荐）
- 使用 Apache Bench (ab) 或 wrk 进行 HTTP 压力测试
- 使用 Shopify 测试订单功能模拟真实下单流程
- 监控应用日志、数据库性能和 API 响应时间
- **重要**：建议在测试环境先进行压测，确认配置无误后再部署到生产环境

**使用内置压测脚本**：
```bash
# 基础压测（10并发，100请求）
node scripts/load-test-pixel-ingestion.mjs

# 自定义并发和请求数
CONCURRENT_REQUESTS=50 TOTAL_REQUESTS=1000 node scripts/load-test-pixel-ingestion.mjs

# 高并发压测（50并发，持续60秒）
CONCURRENT_REQUESTS=50 DURATION=60 node scripts/load-test-pixel-ingestion.mjs

# 仅测试 Origin: null 场景（必须执行）
node scripts/load-test-pixel-ingestion.mjs --null-origin-only

# 指定后端 URL 和店铺域名
SHOPIFY_APP_URL=https://your-app.com SHOP_DOMAIN=test-shop.myshopify.com INGESTION_SECRET=your-secret node scripts/load-test-pixel-ingestion.mjs
```

**压测脚本自动检测内容**：
- Rate limit 触发情况（关键指标）
- Origin: null 场景支持（关键指标）
- 平均响应时间和 QPS
- 错误类型和频率
- 事件处理吞吐量

**上线前压测检查清单**：
- [ ] 高并发压测已执行（50+ 并发，持续 60+ 秒）
- [ ] Origin: null 场景测试已通过
- [ ] Rate limit 配置已验证（无误杀）
- [ ] 事件处理延迟 < 2秒（P95）
- [ ] 错误率 < 0.1%
- [ ] 数据库连接池无耗尽
- [ ] 环境变量 `PIXEL_ALLOW_NULL_ORIGIN=true` 已设置
- [ ] 压测结果已记录并归档

### 商家体验

- **清晰的 Onboarding**：3 步引导快速开始使用
- **诊断工具**：自助排障，快速定位问题
- **FAQ 支持**：常见问题内置解答
- **一键修复**：常见问题一键修复/引导
- **低打扰提示**：仅在关键时刻显示警告

### 监控与告警

- **健康度评分**：基于追踪成功率的综合评分
- **多渠道告警**：支持邮件、Slack、Telegram
- **事件漏斗**：可视化事件处理全流程
- **自动对账**：每日自动检查数据一致性

## 测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test tests/services/scanner.test.ts

# 运行测试并生成覆盖率报告
pnpm test:coverage
```

## 贡献指南

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 许可证

MIT License

## 支持

如有问题，请创建 GitHub Issue 或联系技术支持。
