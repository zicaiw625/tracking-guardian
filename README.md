# Tracking Guardian

**Post-purchase Tracking Guardian** - 帮助 Shopify 商家解决 Checkout Extensibility 迁移后追踪脚本断裂问题的应用。

## 功能特性

### 1. 一键扫描与风险报告
- **自动扫描**：通过 Shopify API 读取已安装的 ScriptTags 和 Web Pixels
- **手动分析**：支持手动粘贴 Additional Scripts 内容进行分析
  - ⚠️ **注意**：Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts，需要商家手动复制粘贴
- 识别 Google、Meta、TikTok 等常见追踪平台
- 生成风险评分和迁移建议
- 动态显示截止日期状态（根据当前日期和店铺类型）

### 2. 一键迁移模板
- Google Analytics 4 / Google Ads
- Meta (Facebook) Pixel
- TikTok Pixel

> **注意**：Microsoft Ads (Bing) 和 Microsoft Clarity 暂不支持服务端追踪。
> - Bing: 建议使用 Microsoft 官方 Shopify 应用
> - Clarity: 客户端会话回放工具，请在主题中直接添加

### 3. 追踪健康监控与送达对账
- 每日自动对账：Shopify Webhook 订单 vs 像素回执 vs 平台送达日志
- 投递成功率监控：检测发送失败、超时、凭证过期等问题
- 送达缺口分析：识别丢失发生在像素端、服务端还是平台端
- 偏差率报警（邮件/Slack/Telegram）
- 可视化监控面板

> **重要说明**：当前对账功能验证的是「事件是否成功发送到广告平台」，而非「平台侧报表中的转化数」。
> 我们保证您能证明事件已发出、能定位丢失发生在哪一环节（像素未触发 / 服务端发送失败 / 平台 API 错误），
> 但**不包含**平台侧转化报表的回读对比（如 Meta Ads Manager 的转化数、Google Ads 的归因报表等）。

### 4. 服务器端转化补齐
- Shopify Webhooks 自动触发
- Meta Conversions API (CAPI)
- GA4 Measurement Protocol（⚠️ 仅支持 GA4，非 Google Ads）
- TikTok Events API

> **重要说明**：
> - **GA4**：使用 GA4 Measurement Protocol 发送服务端事件，适用于 Google Analytics 4 属性
> - **Google Ads**：当前**不支持** Google Ads 离线转化导入（Enhanced Conversions for Leads / Offline Conversions）。如需 Google Ads 归因，建议配合使用 Google 官方 Shopify 应用或 Google Ads 离线转化导入工具
> - 本应用专注于 GA4 + Meta CAPI + TikTok Events API 的统一管理

### 5. TY/OS 页面小组件 (Beta)
- Post-purchase Survey（购后问卷）
- Shipping Tracker（物流追踪）- Beta
- Upsell Offer（二次购买优惠）- Beta
- Support & FAQ 模块（客服入口、FAQ、继续购物）

### 套餐与商业化（对齐“上线即可收费”）

| 套餐 | 定价 | 适用场景 | 核心能力 |
| --- | --- | --- | --- |
| Free | $0 | 扫描、评估阶段 | 扫描报告、截止期提醒、脚本内容本地分析 |
| Growth | $29/mo | 单店/单渠道迁移 | App Pixel 启用、GA4/Meta/TikTok（三选二）CAPI 向导、基础 TY/OS 组件 |
| Pro | $79/mo | 多渠道运营 & 对账 | 多渠道像素、事件送达对账、告警/重试、高级 TY/OS 组件（FAQ/Upsell/Survey） |
| Agency | $199/mo | 多店代理/协作 | 多店铺 & 协作、白标报告、迁移托管支持 |

> 权限/功能 gating 已在前端页面展示：升级 CTA 位于仪表盘与迁移页；默认 plan 为 Free。

## 技术栈

- **框架**: Remix + Shopify App Remix
- **UI**: Shopify Polaris
- **数据库**: PostgreSQL + Prisma ORM
- **扩展**: Web Pixel Extension + Checkout UI Extension

## 快速开始

### 前置要求

- Node.js 20+
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

> 仓库已包含 `pnpm-lock.yaml`，在 CI 或部署环境请使用 `pnpm install --frozen-lockfile` 确保依赖锁定。如需更新依赖，请在可访问 registry 的环境执行 `pnpm install` 并提交更新后的锁文件。

2. **配置环境变量**

创建 `.env` 文件：

```env
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SCOPES=read_orders,read_script_tags,read_pixels,write_pixels,read_customer_events
SHOPIFY_APP_URL=https://your-app-url.com
DATABASE_URL=postgresql://user:password@localhost:5432/tracking_guardian
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

## API 权限说明（P2-04: 最小权限）

| 权限 | 用途 | 代码调用点 | 首次安装必需? |
|------|------|-----------|--------------|
| `read_orders` | 接收 `orders/paid` webhook 发送转化事件 | `webhooks.tsx` | ✅ 是 |
| `read_script_tags` | 扫描旧版 ScriptTags 用于迁移建议 | `scanner.server.ts` | ✅ 是 |
| `read_pixels` | 查询已安装的 Web Pixel 状态 | `migration.server.ts` | ✅ 是 |
| `write_pixels` | 创建/更新 App Pixel Extension | `migration.server.ts` | ✅ 是 |
| `read_customer_events` | （未来）事件对账/同意状态补充 | `app.migrate.tsx` 授权检测 | ⚠️ 场景化 |

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

### P2-04: 最小权限说明

- 所有 4 个 scopes 都有明确的代码调用点和业务理由
- 详细权限说明请参阅 [COMPLIANCE.md](COMPLIANCE.md) 中的 "Scopes Justification" 部分

## Webhook 订阅

- `orders/paid` - 订单支付时发送转化（主要使用）
- `orders/updated` - 订单更新时同步状态
- `app/uninstalled` - 应用卸载时清理数据

### GDPR 合规 Webhook（自动处理）
- `customers/data_request` - 客户数据导出请求
- `customers/redact` - 客户数据删除请求
- `shop/redact` - 店铺数据完全删除

## Built for Shopify (BFS) 特性

### 合规与平台要求

- **GraphQL Admin API**：所有 Admin 操作（WebPixel 创建/删除、checkoutProfiles 查询等）均使用 GraphQL，符合 2025-04-01 起新提交公共应用必须使用 GraphQL Admin API 的要求。代码参考：`app/services/admin-mutations.server.ts`、`app/services/checkout-profile.server.ts`。
- **隐私与最小权限**：仅订阅 `checkout_completed` 事件；默认严格同意策略；PCD 功能需显式开启且数据即时哈希、不落库；权限表见上。
- **上线检查**：健康度评分基于近 7 日对账差异率；监控页记录像素心跳来源与送达率，便于自检 BFS 可靠性指标。

### 性能优化

- **最小化 API 调用**：批量处理订单数据，避免不必要的轮询
- **智能缓存**：使用内存缓存减少重复数据库查询
- **懒加载**：按需加载扫描历史和监控数据

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
