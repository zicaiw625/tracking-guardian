# 监控告警功能实现总结

## ✅ 已实现功能

### 1. 告警检查逻辑 ✅
**位置：** `app/services/alert-dispatcher.server.ts`

实现了以下告警检查：

1. **事件失败率告警** (`checkFailureRate`)
   - 阈值：默认 2%
   - 检查过去 24 小时的事件发送失败率
   - 至少 10 条记录才触发

2. **参数缺失率告警** (`checkMissingParams`)
   - 阈值：默认 10%
   - 检查 Purchase 事件中缺少 value 或 currency 的比例
   - 至少 5 条记录才触发

3. **事件量骤降告警** (`checkVolumeDrop`)
   - 阈值：默认 50%
   - 比较当前 24 小时与前一个 24 小时的事件量
   - 至少前一个 24 小时有 10 条记录才触发

4. **去重冲突告警** (`checkDedupConflicts`)
   - 阈值：默认 5 次冲突
   - 检测同一 eventId 出现多次的情况
   - 统计过去 24 小时的重复事件

5. **像素心跳丢失告警** (`checkPixelHeartbeat`)
   - 阈值：默认 24 小时
   - 检查是否超过指定时间未收到像素事件
   - 严重程度根据时间长度分级

### 2. 告警调度 ✅
**位置：** `app/services/alert-dispatcher.server.ts`

- `runAlertChecks(shopId)` - 运行单个店铺的告警检查
- `runAllShopAlertChecks()` - 批量运行所有店铺的告警检查
- `canSendAlert()` - 基于频率限制检查是否可以发送告警
- 支持频率控制：instant/hourly/daily/weekly

### 3. 告警通知 ✅
**位置：** `app/services/notification.server.ts`

支持三种通知渠道：
- **邮件** (`sendEmailAlert`) - 使用 Resend API
- **Slack** (`sendSlackAlert`) - 使用 Webhook
- **Telegram** (`sendTelegramAlert`) - 使用 Bot API

### 4. 告警配置界面 ✅
**位置：** `app/routes/settings/_components/AlertsTab.tsx`

- 选择通知渠道（邮件/Slack/Telegram）
- 配置告警阈值（失败率阈值）
- 启用/禁用告警
- 测试通知功能
- 查看已配置的告警

### 5. 监控页面集成 ✅
**位置：** `app/routes/app.monitor.tsx`

- 实时告警状态显示
- 告警历史记录
- 告警严重程度标识
- 告警配置提示

### 6. Cron 定时任务 ✅
**位置：** `app/cron/tasks/alert-checks.ts`

- 每小时运行一次告警检查
- 批量处理所有活跃店铺
- 自动发送触发的告警
- 清理过期的 EventNonce 记录

### 7. 告警历史 ✅
**位置：** `app/services/alert-dispatcher.server.ts`

- `getAlertHistory()` - 获取告警历史记录
- `acknowledgeAlert()` - 确认告警（标记为已读）
- 告警记录存储在 `AuditLog` 表中

## 📊 告警数据流

```
1. Cron 任务触发 (每小时)
   ↓
2. runAllShopAlertChecks()
   ↓
3. 对每个店铺运行 runAlertChecks()
   ↓
4. 执行所有告警检查函数
   - checkFailureRate()
   - checkMissingParams()
   - checkVolumeDrop()
   - checkDedupConflicts()
   - checkPixelHeartbeat()
   ↓
5. 过滤触发的告警 (triggered = true)
   ↓
6. 检查频率限制 (canSendAlert)
   ↓
7. 发送通知 (sendAlert)
   - 邮件 / Slack / Telegram
   ↓
8. 更新 lastAlertAt 时间戳
   ↓
9. 记录到 AuditLog
```

## 🔧 配置说明

### AlertConfig 模型
```prisma
model AlertConfig {
  id                    String
  shopId                String
  channel               String  // email, slack, telegram
  settingsEncrypted     String  // 加密的凭证信息
  discrepancyThreshold  Float   // 失败率阈值 (0-1)
  minOrdersForAlert     Int     // 最小订单数
  frequency             String  // daily, weekly, instant
  isEnabled             Boolean
  lastAlertAt           DateTime?
}
```

### 默认阈值
```typescript
{
  failureRateThreshold: 0.02,      // 2% 失败率
  missingParamsThreshold: 0.1,     // 10% 缺参率
  volumeDropThreshold: 0.5,         // 50% 量降
  dedupConflictThreshold: 5,        // 5 次冲突
  heartbeatStaleHours: 24,          // 24 小时
}
```

## 🎯 使用指南

### 1. 配置告警
1. 前往「设置」→「告警」标签页
2. 选择通知渠道（邮件/Slack/Telegram）
3. 填写相应的凭证信息
4. 设置告警阈值（默认 2%）
5. 启用告警并保存

### 2. 查看告警
1. 前往「监控」页面
2. 查看「告警状态」卡片
3. 查看实时告警和历史记录

### 3. 告警类型说明

| 告警类型 | 说明 | 默认阈值 | 严重程度 |
|---------|------|---------|---------|
| 事件失败率 | 发送失败率过高 | 2% | 根据失败率动态调整 |
| 参数缺失率 | Purchase 事件缺参 | 10% | Medium/High |
| 事件量骤降 | 24h 内事件量下降 | 50% | Medium/High/Critical |
| 去重冲突 | 重复事件 ID | 5 次 | Medium/High |
| 像素心跳丢失 | 超过 24h 未收到心跳 | 24h | High/Critical |

## ✅ 符合设计方案要求

根据设计方案 4.6 Monitoring，所有要求的功能已实现：

- ✅ 事件成功率、失败率监控
- ✅ 缺参率监控（value/currency/items）
- ✅ 去重冲突检测
- ✅ 事件量骤降检测（24h）
- ✅ 告警通知（邮件/Slack/Telegram）
- ✅ 告警规则配置
- ✅ 告警历史记录

## 🚀 后续优化建议

1. **告警规则细化**
   - 为每种告警类型单独配置阈值
   - 支持平台级别的告警规则

2. **告警聚合**
   - 相同类型的告警在短时间内聚合发送
   - 避免告警风暴

3. **告警升级**
   - 未确认的告警自动升级
   - 支持告警升级策略

4. **告警仪表板**
   - 告警趋势图表
   - 告警统计报告

5. **告警模板**
   - 自定义告警消息模板
   - 支持多语言告警消息

## 📝 相关文件

- `app/services/alert-dispatcher.server.ts` - 告警检查与调度
- `app/services/notification.server.ts` - 通知发送
- `app/routes/settings/_components/AlertsTab.tsx` - 告警配置界面
- `app/routes/app.monitor.tsx` - 监控页面
- `app/cron/tasks/alert-checks.ts` - Cron 任务
- `prisma/schema.prisma` - AlertConfig 模型

