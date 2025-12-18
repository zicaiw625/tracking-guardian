# Tracking Guardian

**Post-purchase Tracking Guardian** - 帮助 Shopify 商家解决 Checkout Extensibility 迁移后追踪脚本断裂问题的应用。

## 功能特性

### 1. 一键扫描与风险报告
- 扫描店铺的 ScriptTags 和 Additional Scripts
- 识别 Google、Meta、TikTok 等常见追踪平台
- 生成风险评分和迁移建议

### 2. 一键迁移模板
- Google Analytics 4 / Google Ads
- Meta (Facebook) Pixel
- TikTok Pixel
- Microsoft Ads (Bing UET)
- Microsoft Clarity

### 3. 追踪健康监控
- 每日自动对账：Shopify 订单 vs 广告平台转化
- 偏差率报警（邮件/Slack/Telegram）
- 可视化监控面板

### 4. 服务器端转化补齐
- Shopify Webhooks 自动触发
- Meta Conversions API (CAPI)
- Google Ads Conversion API
- TikTok Events API

### 5. TY/OS 页面小组件
- Post-purchase Survey（购后问卷）
- Shipping Tracker（物流追踪）
- Upsell Offer（二次购买优惠）

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
npm install
```

2. **配置环境变量**

创建 `.env` 文件：

```env
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SCOPES=read_orders,read_script_tags,write_script_tags,read_checkouts,write_pixels,read_customer_events
SHOPIFY_APP_URL=https://your-app-url.com
DATABASE_URL=postgresql://user:password@localhost:5432/tracking_guardian
```

3. **初始化数据库**

```bash
npm run generate
npm run db:push
```

4. **启动开发服务器**

```bash
npm run dev
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
│   │   ├── scanner.server.ts   # 扫描服务
│   │   ├── migration.server.ts # 迁移服务
│   │   ├── reconciliation.server.ts # 对账服务
│   │   └── platforms/          # 广告平台集成
│   └── db.server.ts            # Prisma 客户端
├── extensions/
│   ├── tracking-pixel/         # Web Pixel Extension
│   └── thank-you-blocks/       # Checkout UI Extension
├── prisma/
│   └── schema.prisma           # 数据库模型
└── package.json
```

## API 权限说明

| 权限 | 用途 |
|------|------|
| read_orders | 读取订单用于转化对账 |
| read_script_tags | 扫描已安装的 ScriptTags |
| write_script_tags | 管理追踪脚本 |
| read_checkouts | 读取结账配置 |
| write_pixels | 管理 Web Pixels |
| read_customer_events | 读取客户事件数据 |

## Webhook 订阅

- `orders/create` - 新订单创建时发送转化
- `orders/paid` - 订单支付时确认转化
- `app/uninstalled` - 应用卸载清理

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

