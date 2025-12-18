# Tracking Guardian 部署指南

## 快速开始

### 1. 环境准备

确保已安装:
- Node.js 20+
- PostgreSQL 数据库

### 2. 创建 Shopify App

1. 登录 [Shopify Partners](https://partners.shopify.com/)
2. 创建新应用
3. 获取 API Key 和 API Secret

### 3. 配置环境变量

创建 `.env` 文件:

```env
# Shopify Configuration
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here
SCOPES=read_orders,read_script_tags,write_script_tags,read_checkouts,write_pixels,read_customer_events

# App URL (开发时使用 ngrok/cloudflare tunnel)
SHOPIFY_APP_URL=https://your-app-url.com

# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@localhost:5432/tracking_guardian

# Optional: Notification Services
RESEND_API_KEY=your_resend_api_key
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Optional: Cron Secret
CRON_SECRET=your_random_secret_for_cron
```

### 4. 安装依赖并初始化数据库

```bash
# 安装依赖
yarn install

# 生成 Prisma Client
npx prisma generate

# 创建数据库表
npx prisma db push
```

### 5. 本地开发

```bash
# 启动开发服务器
npm run dev
```

访问 `https://localhost:3000` 并使用 Shopify CLI 进行开发:

```bash
shopify app dev
```

### 6. 部署到生产环境

#### Render 部署（推荐 - 免费 PostgreSQL）

**方法 1：使用 Blueprint 一键部署**

1. 将代码推送到 GitHub
2. 访问 [Render Dashboard](https://dashboard.render.com/)
3. 点击 "New" → "Blueprint"
4. 连接 GitHub 仓库，选择包含 `render.yaml` 的仓库
5. Render 会自动创建数据库和 Web 服务
6. 在 Environment 中设置必需的环境变量：
   - `SHOPIFY_API_KEY`
   - `SHOPIFY_API_SECRET`
   - `SHOPIFY_APP_URL`（部署后获取的 URL）

**方法 2：手动创建**

1. **创建 PostgreSQL 数据库**
   - Dashboard → New → PostgreSQL
   - 选择 Free 计划
   - 记录 Internal Database URL

2. **创建 Web Service**
   - Dashboard → New → Web Service
   - 连接 GitHub 仓库
   - 配置：
     - Build Command: `npm run render-build`
     - Start Command: `npm run start`
   - 添加环境变量：
     ```
     DATABASE_URL=<Internal Database URL>
     SHOPIFY_API_KEY=your_key
     SHOPIFY_API_SECRET=your_secret
     SHOPIFY_APP_URL=https://your-app.onrender.com
     SCOPES=read_orders,read_script_tags,write_script_tags,read_checkouts,write_pixels,read_customer_events
     ```

3. **配置定时任务（Cron Job）**
   - Dashboard → New → Cron Job
   - Schedule: `0 2 * * *`（每天凌晨 2 点）
   - Command: `curl -X POST https://your-app.onrender.com/api/cron -H "Authorization: Bearer $CRON_SECRET"`

#### Vercel 部署

1. 连接 GitHub 仓库
2. 添加环境变量（需要外部 PostgreSQL，如 Neon/Supabase）
3. 部署

#### Railway 部署

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login

# 创建项目
railway init

# 部署
railway up
```

### 7. 配置 Shopify App

更新 `shopify.app.toml`:

```toml
client_id = "YOUR_CLIENT_ID"
application_url = "https://your-production-url.com"
```

### 8. 安装 Extensions

Extensions 需要单独安装:

```bash
cd extensions/tracking-pixel
npm install

cd ../thank-you-blocks  
npm install
```

使用 Shopify CLI 部署 extensions:

```bash
shopify app deploy
```

## 定时任务配置

### Vercel Cron

已在 `vercel.json` 中配置，每天凌晨 2 点运行对账任务。

### 手动触发

```bash
curl -X POST https://your-app-url.com/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## 常见问题

### 数据库连接失败

检查 `DATABASE_URL` 格式:
```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

### Extensions 不显示

确保:
1. App 已安装到店铺
2. Extensions 已部署 (`shopify app deploy`)
3. 在店铺后台启用 extensions

### Webhook 不触发

检查:
1. App 已正确认证
2. 店铺已授权相应权限
3. Webhook URL 可访问

## 技术支持

如有问题，请创建 GitHub Issue。

