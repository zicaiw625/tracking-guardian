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
# ===========================================
# Shopify Configuration (REQUIRED)
# ===========================================
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here
SCOPES=read_orders,read_script_tags,read_pixels,write_pixels,read_customer_events

# App URL (开发时使用 ngrok/cloudflare tunnel)
SHOPIFY_APP_URL=https://your-app-url.com

# Development store URL (for shopify.app.toml)
SHOPIFY_DEV_STORE_URL=your-dev-store.myshopify.com

# ===========================================
# Database (REQUIRED)
# ===========================================
DATABASE_URL=postgresql://user:password@localhost:5432/tracking_guardian

# ===========================================
# Security (REQUIRED in production)
# ===========================================
# Encryption key for sensitive data
# Generate with: openssl rand -base64 32
ENCRYPTION_SECRET=your_encryption_secret_key_here

# Cron endpoint authentication
# Generate with: openssl rand -hex 32
CRON_SECRET=your_random_secret_for_cron

# ===========================================
# Notification Services (Optional)
# ===========================================
# Email notifications via Resend
RESEND_API_KEY=your_resend_api_key
# Custom email sender (must be verified domain)
EMAIL_SENDER=Tracking Guardian <alerts@yourdomain.com>

# Slack notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx

# Telegram notifications
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
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
     SCOPES=read_orders,read_script_tags,read_pixels,write_pixels,read_customer_events
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

## Secrets 管理与轮换

### 必需的环境变量

| 变量名 | 用途 | 生成方式 | 轮换周期 |
|--------|------|----------|----------|
| `SHOPIFY_API_KEY` | OAuth 应用标识 | Partner Dashboard | 不需轮换 |
| `SHOPIFY_API_SECRET` | OAuth 签名验证 | Partner Dashboard | 按需（泄露时） |
| `DATABASE_URL` | 数据库连接 | 数据库服务商 | 按需 |
| `ENCRYPTION_SECRET` | 敏感数据加密 | `openssl rand -base64 32` | 建议每年 |
| `CRON_SECRET` | Cron 端点认证 | `openssl rand -hex 32` | 建议每季度 |

### 敏感数据加密

应用使用 AES-256-GCM 加密以下敏感数据：
- 平台凭证（Meta Access Token、Google API Secret 等）
- 店铺 Ingestion Secret
- 告警 Webhook URL（Slack、Telegram）

#### 生成 ENCRYPTION_SECRET

```bash
# 方法 1：使用 OpenSSL
openssl rand -base64 32

# 方法 2：使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**重要**：
- 首次部署前必须设置 `ENCRYPTION_SECRET`
- 更换 `ENCRYPTION_SECRET` 会导致所有已加密数据无法解密
- 建议在更换前进行数据备份

### Ingestion Secret 轮换

Ingestion Secret 用于关联 Web Pixel 事件和后端处理。

#### 手动轮换步骤

1. 登录应用后台 → 「设置」 → 「安全与隐私」
2. 点击「更换令牌」按钮
3. 确认操作
4. Web Pixel 会自动更新为新令牌

#### 轮换期间的兼容性

- 旧令牌在更换后 **30 分钟** 内仍然有效（Grace Window）
- 这确保正在进行中的 checkout 不会丢失事件

#### 强制立即失效（紧急情况）

如果怀疑令牌泄露，需要立即失效：

```bash
# 连接数据库
psql $DATABASE_URL

# 清除 grace window
UPDATE "Shop" 
SET "previousIngestionSecret" = NULL, "previousSecretExpiry" = NULL 
WHERE "shopDomain" = 'your-store.myshopify.com';
```

### 平台凭证轮换

#### Meta Access Token

1. 前往 [Meta Events Manager](https://business.facebook.com/events_manager)
2. 选择您的 Pixel → 设置 → Conversions API
3. 生成新的系统用户 Access Token
4. 在应用「设置」页面更新 Meta 配置

**注意**：Meta Access Token 有过期时间，请关注 Meta 的通知邮件。

#### Google API Secret

1. 前往 [Google Analytics](https://analytics.google.com/)
2. 管理 → 数据流 → 选择您的数据流
3. Measurement Protocol API 密钥 → 创建新密钥
4. 在应用「设置」页面更新 Google 配置
5. 删除旧密钥

#### TikTok Access Token

1. 前往 [TikTok Events Manager](https://ads.tiktok.com/marketing_api/apps/)
2. 选择您的应用 → Settings
3. 生成新的 Access Token
4. 在应用「设置」页面更新 TikTok 配置

### CRON_SECRET 轮换

1. 生成新的 secret：
   ```bash
   openssl rand -hex 32
   ```

2. 更新部署平台的环境变量

3. 更新 cron job 配置（如 Render Cron Job）

### 安全审计

定期检查 `AuditLog` 表中的敏感操作记录：

```sql
-- 查看最近的凭证变更
SELECT * FROM "AuditLog" 
WHERE "action" IN ('ingestion_secret_rotated', 'pixel_config_changed', 'alert_config_updated')
ORDER BY "createdAt" DESC 
LIMIT 50;
```

---

## 技术支持

如有问题，请创建 GitHub Issue。

