# 数据保留策略 (Data Retention Policy)

本文档定义了 Tracking Guardian 的数据保留策略，用于确保 GDPR/CCPA 合规。

> **P2-1 合规更新 (2025-12)**: 本文档已更新以明确各数据类型的保留期、删除时机和审计证明方法。

## 概述

Tracking Guardian 遵循数据最小化原则：

1. **只收集必要数据**: 仅收集转化追踪所需的订单数据
2. **不存储 PII**: 不存储客户邮箱、电话、地址等个人信息
3. **可配置保留期**: 商家可自定义数据保留时长
4. **自动清理**: 过期数据由定时任务自动删除
5. **GDPR 合规**: 完整实现删除请求处理

## 数据分类

### 1. 转化数据 (Conversion Data)

| 表名 | 数据类型 | 默认保留期 | 可配置 | 说明 |
|------|----------|------------|--------|------|
| `ConversionLog` | 订单转化记录 | 90 天 | ✅ | 包含 orderId, orderValue, 平台状态 |
| `ConversionJob` | 转化任务队列 | 30 天 | ✅ | 处理完成后的任务记录 |
| `PixelEventReceipt` | 像素事件收据 | 90 天 | ✅ | 客户端事件记录，用于同意验证 |
| `SurveyResponse` | 问卷响应 | 90 天 | ✅ | 客户自愿提供的反馈 |

### 2. 审计与监控数据

| 表名 | 数据类型 | 默认保留期 | 可配置 | 说明 |
|------|----------|------------|--------|------|
| `AuditLog` | 安全审计日志 | 180 天 | ❌ | 敏感操作记录（如 token 更新） |
| `WebhookLog` | Webhook 幂等记录 | 7 天 | ❌ | 防止重复处理 |
| `ReconciliationReport` | 对账报告 | 90 天 | ✅ | 每日对账数据 |

### 3. GDPR 任务数据

| 表名 | 数据类型 | 默认保留期 | 可配置 | 说明 |
|------|----------|------------|--------|------|
| `GDPRJob` | GDPR 请求队列 | 完成后 30 天 | ❌ | 完成后保留供审计 |

## 保留期配置

每个商店可通过设置页面配置数据保留期：

```typescript
// Shop.dataRetentionDays 字段
// 默认值: 90 天
// 可选值: 30, 60, 90, 180, 365, 0 (0 = 不自动删除)
```

## 清理策略

### 自动清理 (Cron Job)

建议在 `app/routes/api.cron.tsx` 中添加每日清理任务：

```typescript
// 示例清理逻辑
async function cleanupExpiredData() {
  const shops = await prisma.shop.findMany({
    where: { isActive: true, dataRetentionDays: { gt: 0 } },
    select: { id: true, dataRetentionDays: true },
  });

  for (const shop of shops) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - shop.dataRetentionDays);

    await prisma.conversionLog.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
      },
    });

    // ... 其他表的清理
  }
}
```

### GDPR 删除请求

当收到 `customers/redact` 或 `shop/redact` webhook 时：

1. **客户删除 (customers/redact)**：删除该客户相关的订单数据
2. **商店删除 (shop/redact)**：删除该商店的全部数据

## PII 最小化

本应用不存储以下 PII：

- ❌ 客户邮箱 (email)
- ❌ 客户电话 (phone)
- ❌ 客户地址 (address)

所有 PII 仅在内存中临时处理（如需要哈希后发送到广告平台），不落库。

## GDPR 删除处理

### 删除请求类型

| Webhook | 触发时机 | 删除范围 | 完成时限 |
|---------|----------|----------|----------|
| `customers/data_request` | 客户请求数据副本 | N/A (只读取) | 30 天 |
| `customers/redact` | 客户请求删除 | 指定订单相关数据 | 30 天 |
| `shop/redact` | 商店卸载 48 小时后 | 全部商店数据 | 30 天 |

### 删除证明 (Audit Trail)

每个 GDPR 请求都会在 `GDPRJob` 表中记录：

```typescript
// GDPRJob 记录示例
{
  id: "gdpr_xxx",
  shopDomain: "store.myshopify.com",
  jobType: "customer_redact",
  status: "completed",
  payload: {
    customer_id: 123,
    orders_to_redact: [456, 789]
  },
  result: {
    deletedConversionLogs: 5,
    deletedPixelReceipts: 3,
    deletedSurveyResponses: 1,
    completedAt: "2025-12-21T12:00:00Z"
  },
  createdAt: "2025-12-20T12:00:00Z",
  completedAt: "2025-12-21T12:00:00Z"
}
```

### 数据删除确认

删除后，相关数据应无法查询：

```sql
-- 验证客户数据已删除
SELECT COUNT(*) FROM "ConversionLog" 
WHERE "orderId" IN ('deleted_order_id');
-- 预期结果: 0

-- 验证商店数据已删除
SELECT COUNT(*) FROM "Shop" 
WHERE "shopDomain" = 'deleted-store.myshopify.com';
-- 预期结果: 0
```

## 合规检查清单

- [x] `ConversionJob.orderPayload` 字段已迁移到 `capiInput`（不含 PII）
- [x] 日志中不打印 PII（`logger.ts` 有敏感字段过滤）
- [x] GDPR 任务在 30 天内可闭环
- [ ] 商家可在设置页面查看/修改数据保留期
- [x] 自动清理任务在 cron 中运行

## 相关代码位置

- 数据模型: `prisma/schema.prisma`
- GDPR 处理: `app/services/gdpr.server.ts`
- 清理逻辑: `app/routes/api.cron.tsx`
- 日志过滤: `app/utils/logger.ts`
- Webhook 处理: `app/routes/webhooks.tsx`

---

*最后更新: 2025-12-21 (P2-1 合规增强)*

