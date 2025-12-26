# Render 部署指南

本文档详细说明如何在 Render 上部署 Tracking Guardian，包括 Web Service、Database 和 Cron Job 的完整配置。

## 目录

- [前置条件](#前置条件)
- [一键部署](#一键部署)
- [Cron Job 配置（重要）](#cron-job-配置重要)
- [环境变量说明](#环境变量说明)
- [验证部署](#验证部署)
- [故障排查](#故障排查)

---

## 前置条件

1. Render 账号（https://render.com）
2. Shopify Partner 账号和已创建的 App
3. 获取以下 Shopify 配置：
   - `SHOPIFY_API_KEY`
   - `SHOPIFY_API_SECRET`

---

## 一键部署

### 方式一：使用 Blueprint（推荐）

1. Fork 本仓库到你的 GitHub
2. 登录 Render Dashboard
3. 点击 **New** → **Blueprint**
4. 选择你 fork 的仓库
5. Render 会自动读取 `render.yaml` 并创建：
   - Web Service: `tracking-guardian`
   - Database: `tracking-guardian-db`
6. 在部署前配置必需的环境变量（见下方）

### 方式二：手动创建

参考 `render.yaml` 文件手动创建各个服务。

---

## Cron Job 配置（重要）

> ⚠️ **注意**：Render Blueprint 目前不支持声明 Cron Job，必须在 Dashboard 手动创建！

Cron Job 负责执行以下关键任务：
- GDPR 合规处理（法规要求）
- 数据清理（防止存储爆满）
- Conversion 重试（确保数据不丢失）
- 交付健康度检查
- 店铺状态刷新

### 创建步骤

1. 登录 [Render Dashboard](https://dashboard.render.com)

2. 点击 **New** → **Cron Job**

3. 填写基本信息：
   | 字段 | 值 |
   |------|-----|
   | Name | `tracking-guardian-cron` |
   | Region | `Singapore`（与 Web Service 一致） |
   | Branch | `main` |

4. 配置 Build & Deploy：
   | 字段 | 值 |
   |------|-----|
   | Build Command | *(留空)* |
   | Command | `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tracking-guardian.onrender.com/api/cron` |

5. 配置 Schedule：
   | 调度模式 | Cron 表达式 | 说明 |
   |---------|------------|------|
   | 标准（推荐） | `*/5 * * * *` | 每 5 分钟 |
   | 轻量 | `*/10 * * * *` | 每 10 分钟 |
   | 最小化 | `*/15 * * * *` | 每 15 分钟 |

6. 配置 Environment Variables：
   | Key | Value |
   |-----|-------|
   | `CRON_SECRET` | 从 Web Service 复制，或设置相同的值 |

7. 点击 **Create Cron Job**

### 使用脚本（可选）

如果需要更复杂的调用逻辑（如重放保护），可以使用项目中的脚本：

```bash
# Render Cron Job Command
./scripts/render-cron.sh

# 或带重放保护
REPLAY_PROTECTION=true ./scripts/render-cron.sh
```

---

## 环境变量说明

### 必需变量

| 变量 | 说明 | 设置方式 |
|------|------|----------|
| `SHOPIFY_API_KEY` | Shopify App API Key | Dashboard 手动设置 |
| `SHOPIFY_API_SECRET` | Shopify App API Secret | Dashboard 手动设置 |
| `SHOPIFY_APP_URL` | 部署后的应用 URL | 部署后设置，如 `https://tracking-guardian.onrender.com` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | Blueprint 自动关联 |

### 自动生成变量

| 变量 | 说明 |
|------|------|
| `CRON_SECRET` | Cron 端点认证密钥 |
| `ENCRYPTION_SECRET` | 数据加密密钥 |

### 可选变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PCD_APPROVED` | PCD 审批状态 | `"false"` |
| `RESEND_API_KEY` | Resend 邮件服务 API Key | - |
| `EMAIL_SENDER` | 发件人邮箱 | - |
| `SLACK_WEBHOOK_URL` | Slack 通知 Webhook | - |
| `CRON_SECRET_PREVIOUS` | 密钥轮换时的旧密钥 | - |
| `CRON_STRICT_REPLAY` | 是否强制重放保护 | `"true"` |

---

## 验证部署

### 1. 健康检查

```bash
# 基础健康检查
curl https://tracking-guardian.onrender.com/api/health

# 详细健康检查（需要认证）
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://tracking-guardian.onrender.com/api/health?detailed=true"
```

预期响应：
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "uptime": 3600
}
```

### 2. Cron 端点测试

```bash
# 测试 Cron 认证
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://tracking-guardian.onrender.com/api/cron
```

预期响应（成功）：
```json
{
  "status": "success",
  "requestId": "cron-1234567890-abcd",
  "durationMs": 1234,
  "gdpr": { "processed": 0, "succeeded": 0, "failed": 0 },
  ...
}
```

预期响应（锁冲突）：
```json
{
  "status": "skipped",
  "requestId": "cron-1234567890-abcd",
  "reason": "Lock held by another instance"
}
```

### 3. 检查 Cron Job 日志

1. 进入 Render Dashboard → Cron Jobs → `tracking-guardian-cron`
2. 查看 **Logs** 标签页
3. 确认：
   - 请求成功返回 200
   - 锁机制正常工作（多实例不重复执行）
   - 任务执行结果有结构化输出

---

## 故障排查

### Cron Job 未执行

1. **检查 Cron Job 是否创建**
   - Dashboard → Cron Jobs 列表

2. **检查 Schedule 是否正确**
   - `*/5 * * * *` 表示每 5 分钟

3. **检查 CRON_SECRET**
   - 确保 Cron Job 和 Web Service 使用相同的 secret

### 认证失败 (401/403)

1. **检查 Authorization Header 格式**
   - 必须是 `Bearer <token>` 格式

2. **检查 CRON_SECRET 值**
   - 在 Render Dashboard 中对比两边的值

3. **检查密钥轮换状态**
   - 如果正在轮换，设置 `CRON_SECRET_PREVIOUS`

### 锁冲突频繁

1. **检查执行时长**
   - 如果 Cron 任务执行超过 5 分钟，考虑增加调度间隔

2. **检查数据库性能**
   - 锁存储在 `WebhookLog` 表中

### 数据库连接失败

1. **检查 DATABASE_URL**
   - 确保 Blueprint 正确关联了数据库

2. **检查 Region**
   - Web Service 和 Database 应在同一 Region

---

## 密钥轮换

### 步骤

1. 生成新密钥：
   ```bash
   openssl rand -hex 32
   ```

2. 在 Web Service 设置：
   - `CRON_SECRET_PREVIOUS` = 当前的 `CRON_SECRET`
   - `CRON_SECRET` = 新生成的密钥

3. 部署 Web Service

4. 更新 Cron Job 的 `CRON_SECRET` 为新密钥

5. 验证正常后，删除 `CRON_SECRET_PREVIOUS`

---

## 相关文档

- [Render Blueprint Spec](https://render.com/docs/blueprint-spec)
- [Render Cron Jobs](https://render.com/docs/cronjobs)
- [API 参考文档](./API_REFERENCE.md)

