# Tracking Guardian 部署指南

## 快速开始

### 1. 环境准备

确保已安装:
- Node.js 22.18+ (required for running TypeScript scripts directly with the Node runtime)
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
pnpm install

# 生成 Prisma Client
pnpm generate

# 创建数据库表（使用 migrate deploy，保持与生产一致）
pnpm db:deploy
```

> 仓库已包含 `pnpm-lock.yaml`，后续在 CI 或部署环境请使用 `pnpm install --frozen-lockfile` 确保依赖版本锁定。当前锁文件基于本地缓存生成，如需与官方 registry 完全同步，请在可访问 npm registry 的环境重新运行 `pnpm install --lockfile-only` / `pnpm install` 更新锁文件并提交。

### 5. 本地开发

```bash
# 启动开发服务器
pnpm dev
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
    - Build Command: `pnpm render-build`
    - Start Command: `pnpm start`
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
pnpm add -g @railway/cli

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

### 8. 部署 Extensions（重要！）

Extensions 需要通过 Shopify CLI 部署。**首次部署会自动生成必需的 `uid` 字段**。

#### 8.1 安装 Extension 依赖

```bash
cd extensions/tracking-pixel
pnpm install

cd ../thank-you-blocks  
pnpm install
```

#### 8.2 部署 Extensions（首次部署会生成 uid）

```bash
# 回到项目根目录
cd ../..

# 部署所有 extensions
shopify app deploy
```

**⚠️ 重要：Web Pixel uid 说明**

- `extensions/tracking-pixel/shopify.extension.toml` 需要一个 `uid` 字段
- 这个 `uid` 是 Shopify 的 **必填项**，不能手动编造
- **首次运行 `shopify app deploy` 时，CLI 会自动生成并写入 uid**
- 部署后，检查 toml 文件是否已添加类似 `uid = "gid://shopify/WebPixel/xxx"` 的行

#### 8.3 验证部署成功

```bash
# 查看已部署的 extensions
shopify app info --extensions

# 检查 uid 是否已生成
cat extensions/tracking-pixel/shopify.extension.toml | grep uid
```

如果 uid 未自动生成，可以手动触发：

```bash
# 重新生成 extension 配置
shopify app generate extension --type web_pixel --name "tracking-guardian-pixel"
# 然后将生成的 uid 复制到现有的 toml 文件
```

#### 8.4 在开发店铺测试

```bash
# 启动开发模式
shopify app dev

# 这会：
# 1. 启动本地开发服务器
# 2. 创建隧道暴露本地服务
# 3. 在开发店铺安装 app 和 extensions
```

安装后，在开发店铺进行一次完整的 checkout 流程，验证：
1. Web Pixel 是否正确加载（查看浏览器 Network 面板）
2. `checkout_completed` 事件是否发送到后端
3. `PixelEventReceipt` 是否正确写入数据库

#### 8.5 常见 Extension 部署问题排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `No extension found` | uid 未生成 | 运行 `shopify app deploy` 首次部署 |
| `webPixelCreate failed: schema validation error` | settings schema 不匹配 | 检查 toml 中的 settings.fields 是否与 buildWebPixelSettings() 一致 |
| `Extension not showing in checkout editor` | 未正确部署 | 运行 `shopify app deploy --force` 强制重新部署 |
| `checkout_completed event not firing` | Pixel 未加载 | 检查 Customer Privacy 设置，确认用户已同意 |
| `Extension blocks not appearing` | 未添加到页面 | 在 Shopify 后台 → 设置 → 结账 → 自定义 → 添加区块 |

#### 8.6 Checkout UI Extensions（Thank You Blocks）

Tracking Guardian 包含以下 Checkout UI Extensions：

| Block | Target | 用途 |
|-------|--------|------|
| Post-purchase Survey | purchase.thank-you.block.render | 购后问卷调查 |
| Order Status Survey | customer-account.order-status.block.render | 订单状态页问卷 |
| Shipping Progress Tracker | purchase.thank-you.block.render | 订单状态进度提示 |
| Order Status Shipping Tracker | customer-account.order-status.block.render | 订单状态页进度 |
| Thank You Upsell Offer | purchase.thank-you.block.render | 复购优惠券 |
| Order Status Upsell Offer | customer-account.order-status.block.render | 订单状态页优惠 |

**添加 Block 到页面：**

1. 前往 Shopify 后台 → 设置 → 结账
2. 点击「自定义」打开 Checkout Editor
3. 在 Thank You Page 或 Order Status Page 区域点击「添加区块」
4. 选择 Tracking Guardian 的 Block
5. 配置 Block 设置（如 Survey 标题、优惠码等）
6. 保存并发布

**配置 Block 设置：**

所有 Block 设置在 `extensions/thank-you-blocks/shopify.extension.toml` 的 `[settings]` 中定义。
商家可以在 Checkout Editor 中自定义这些设置。

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

### 可选环境变量

| 变量名 | 用途 | 默认值 | 说明 |
|--------|------|--------|------|
| `PCD_APPROVED` | PCD 审核状态 | `false` | **重要**：仅在获得 Shopify PCD 批准后设为 `true` |
| `PCD_STATUS_MESSAGE` | 自定义 PCD 状态消息 | 空 | 可选：在 UI 中显示的自定义状态消息 |
| `RESEND_API_KEY` | 邮件通知 | 空 | Resend.com API 密钥 |
| `EMAIL_SENDER` | 发件人地址 | 空 | 邮件通知发送地址 |
| `REDIS_URL` | 共享限流 | 空 | Redis 连接 URL（多实例部署） |

#### PCD（Protected Customer Data）配置

**⚠️ 重要**：`PCD_APPROVED` 环境变量控制是否允许商户启用 PII 增强匹配功能。

- **默认值 `false`**：禁用 PII 增强匹配开关，商户无法启用此功能
- **设为 `true`**：允许商户启用增强匹配，但 UI 不会声称"已通过审核"
- **自动降级**：即使 `PCD_APPROVED=true`，若 Shopify 实际未返回 PII 字段（返回 null），应用会自动降级为隐私优先模式

**注意**：
- 2025-12-10 起，Web Pixel 中的 PII 字段需要 PCD 审核才能获取
- UI 中使用中性表述，不直接声称"已获得批准"，而是说明功能可用性和降级机制
- 这样即使 PCD 状态发生变化，也不会产生误导

```bash
# 允许商户启用增强匹配功能
PCD_APPROVED=true

# 可选：自定义状态消息（显示在 UI 中）
PCD_STATUS_MESSAGE="增强匹配功能已开放，若 PII 不可用将自动降级"
```

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

## 生产环境部署检查清单

在部署到生产环境之前，请确保以下项目已完成：

### 必需环境变量

| 变量 | 说明 | 验证方式 |
|------|------|----------|
| `ENCRYPTION_SECRET` | 敏感数据加密密钥 | `openssl rand -base64 32` 生成，至少 32 字符 |
| `CRON_SECRET` | Cron 端点认证 | `openssl rand -hex 32` 生成，至少 32 字符 |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 必须以 `postgresql://` 或 `postgres://` 开头 |
| `SHOPIFY_API_KEY` | Shopify 应用 API Key | 从 Partner Dashboard 获取 |
| `SHOPIFY_API_SECRET` | Shopify 应用 API Secret | 从 Partner Dashboard 获取 |
| `SHOPIFY_APP_URL` | 应用公开 URL | **必须使用 HTTPS** |

### 推荐环境变量

| 变量 | 说明 | 默认行为 |
|------|------|----------|
| `REDIS_URL` | Redis 连接 | 无 Redis 时使用内存存储（单实例限制） |
| `RESEND_API_KEY` | 邮件通知 | 禁用邮件告警 |
| `ENCRYPTION_SALT` | 密钥派生盐值 | 使用固定默认值 |

### 安全检查

- [ ] `ALLOW_UNSIGNED_PIXEL_EVENTS` **未设置或设为 false**（生产环境禁止为 true）
- [ ] `ENCRYPTION_SECRET` 不是默认值或占位符
- [ ] `CRON_SECRET` 不是默认值或占位符
- [ ] `SHOPIFY_APP_URL` 使用 HTTPS
- [ ] 数据库使用 SSL 连接（生产环境推荐）

### 功能验证

1. **应用安装**
   - [ ] OAuth 流程正常完成
   - [ ] 店铺数据正确保存到数据库

2. **Webhook 处理**
   - [ ] `ORDERS_PAID` webhook 正常接收和处理
   - [ ] GDPR webhooks 正常处理

3. **Web Pixel**
   - [ ] Pixel 正确加载（查看浏览器 Network）
   - [ ] `checkout_completed` 事件发送成功
   - [ ] `PixelEventReceipt` 正确写入数据库

4. **转化发送**
   - [ ] Meta CAPI 正常发送
   - [ ] Google Analytics MP 正常发送
   - [ ] TikTok Events API 正常发送

5. **Cron 任务**
   - [ ] 端点认证正常（Bearer token 验证）
   - [ ] 数据清理任务正常运行

### 启动时验证

应用启动时会自动验证配置。在日志中检查：

```
=== Configuration Status ===
Environment: production
✅ All configuration checks passed
============================
```

如果看到警告或错误，请按提示修复配置。

---

## 技术支持

如有问题，请创建 GitHub Issue。
