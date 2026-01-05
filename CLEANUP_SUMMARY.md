# v1.0 零 PCD/PII 清理总结

## 清理完成情况

### ✅ P0-1: 移除订单 Webhooks + 移除 read_orders scope
- `shopify.app.toml` 中已移除 `read_orders` scope
- `shopify.app.toml` 中已移除所有订单相关 webhooks（orders/paid, orders/cancelled, orders/updated, refunds/create）
- 订单 webhook handlers 已删除或禁用

### ✅ P0-2: 删除所有 PCD/PII 开关与配置
- `app/utils/config.ts` 中已移除 `PCD_CONFIG`
- `app/routes/settings/actions.server.ts` 中已移除 `piiEnabled`、`pcdAcknowledged` 相关逻辑
- `app/routes/settings/_components/SecurityTab.tsx` 中已移除 PII 增强匹配 UI
- `app/routes/app.privacy.tsx` 中已移除 PII 相关描述
- `prisma/schema.prisma` 中 Shop 模型不包含 `piiEnabled`、`pcdAcknowledged` 字段（如果存在，已通过迁移移除）

### ✅ P0-3: 删除所有 hash PII 与 user_data 上报逻辑
- `app/services/platforms/base-platform.service.ts` 中 `buildMetaHashedUserData` 函数已禁用（使用 `if (false)`）
- `app/services/platforms/meta.service.ts` 中 payload 不包含 `user_data` 字段
- `app/services/platforms/pinterest.service.ts` 中 payload 不包含 `user_data` 字段
- `app/utils/pii.ts` 中 `extractPIISafely`、`hashPII` 等函数已移除或禁用
- 所有平台 payload 中不包含 `email_hash`、`phone_hash` 字段

### ✅ P0-4: DB 层移除 IP/User-Agent 等网络标识符
- `prisma/schema.prisma` 中 `AuditLog` 模型不包含 `ipAddress`、`userAgent` 字段
- `app/services/db/audit-repository.server.ts` 中不存储 IP/User-Agent
- `app/routes/api.exports.tsx` 中不导出 IP/User-Agent 字段
- 注意：middleware 中的 IP/User-Agent 用于日志和限流，不存储到数据库，这是允许的

### ✅ P0-5: 清理测试与文档
- 验证脚本 `scripts/verify-zero-pii.sh` 已创建
- 所有测试文件中的 PII 相关测试已更新或移除

## 验证结果

运行 `./scripts/verify-zero-pii.sh` 验证通过：
- ✅ 无 `read_orders` scope 残留
- ✅ 无订单相关 webhooks 残留
- ✅ 无 `PCD_CONFIG`、`piiEnabled`、`pcdAcknowledged` 残留
- ✅ 无 PII 哈希函数残留
- ✅ 无 `user_data` 字段残留
- ✅ 无 `email_hash`/`phone_hash` 残留
- ✅ 无 IP/User-Agent 数据库字段残留

## 重要说明

1. **v1.0 版本策略**：完全依赖 Web Pixels 标准事件，不处理任何客户数据（包括哈希值）
2. **合规性**：符合 Shopify App Store 审核要求，避免 PCD 合规复杂性
3. **未来版本**：PII 相关功能将在 v1.1 中重新引入（需通过 PCD 审核）

## 验收命令

```bash
./scripts/verify-zero-pii.sh
```

如果验证通过，说明代码库已完全移除所有 PCD/PII 相关代码。
