# API Reference

本文档描述了重构后代码库的公共 API 和使用方式。

## 目录

1. [类型系统](#类型系统)
2. [Schema 验证](#schema-验证)
3. [平台服务](#平台服务)
4. [数据库操作](#数据库操作)
5. [React Hooks](#react-hooks)
6. [迁移优先级服务](#迁移优先级服务)
7. [监控服务](#监控服务)
8. [批量操作服务](#批量操作服务)
9. [渠道对账服务](#渠道对账服务)

---

## 类型系统

### 枚举常量

所有枚举常量位于 `app/types/enums.ts`：

```typescript
import { 
  JobStatus,        // 任务状态
  SignatureStatus,  // 签名验证状态
  TrustLevel,       // 信任级别
  Platform,         // 平台类型
  ConsentStrategy,  // 同意策略
} from '@/types';

// 使用示例
if (job.status === JobStatus.COMPLETED) {
  // ...
}
```

### 数据库 JSON 字段解析

安全解析 Prisma JSON 字段：

```typescript
import { 
  parseCapiInput, 
  parseConsentState,
  parsePixelClientConfig,
} from '@/types';

// 解析 CAPI 输入
const capiInput = parseCapiInput(job.capiInput);
if (capiInput?.checkoutToken) {
  // 类型安全访问
}

// 解析同意状态
const consent = parseConsentState(receipt.consentState);
if (consent?.marketing === true) {
  // 允许营销追踪
}
```

---

## Schema 验证

### Pixel 事件验证

```typescript
import { 
  validatePixelEvent,
  PixelEventSchema,
  isPrimaryEvent,
} from '@/schemas';

// 验证完整事件
const result = validatePixelEvent(payload);
if (!result.success) {
  console.error('验证失败:', result.errors);
  return;
}

// 使用验证后的数据
const event = result.data;
if (isPrimaryEvent(event.eventName)) {
  // 处理主要事件（如购买）
}
```

### Webhook 载荷验证

```typescript
import { 
  validateOrderPayload,
  extractOrderId,
  calculateOrderValue,
} from '@/schemas';

const result = validateOrderPayload(webhookBody);
if (result.success) {
  const orderId = extractOrderId(result.data);
  const value = calculateOrderValue(result.data);
}
```

---

## 平台服务

### 工厂模式

```typescript
import { 
  getPlatformService, 
  sendConversionToPlatform,
  isPlatformSupported,
} from '@/services/platforms/factory';

// 检查平台支持
if (!isPlatformSupported(platform)) {
  throw new Error('不支持的平台');
}

// 获取服务实例
const service = getPlatformService('google');

// 发送转化事件
const result = await sendConversionToPlatform(
  'google',
  credentials,
  conversionData,
  eventId
);

if (result.success) {
  console.log('发送成功', result.response);
} else {
  console.error('发送失败', result.error);
}
```

### 批量发送

```typescript
import { sendConversionToMultiplePlatforms } from '@/services/platforms/factory';

const results = await sendConversionToMultiplePlatforms(
  [
    { platform: 'google', credentials: googleCreds },
    { platform: 'meta', credentials: metaCreds },
  ],
  conversionData,
  eventId
);

for (const [platform, result] of Object.entries(results)) {
  console.log(`${platform}: ${result.success ? '成功' : '失败'}`);
}
```

### 凭证验证

```typescript
import { validatePlatformCredentials } from '@/services/platforms/factory';

const validation = validatePlatformCredentials('google', {
  measurementId: 'G-ABC123',
  apiSecret: 'secret',
});

if (!validation.valid) {
  console.error('凭证无效:', validation.errors);
}
```

---

## 数据库操作

### Shop 仓库

```typescript
import { 
  getShopById,
  getShopWithPixels,
  batchGetShops,
  invalidateShopCache,
} from '@/services/db';

// 获取基本信息（带缓存）
const shop = await getShopById(shopId);

// 获取包含 Pixel 配置的完整信息
const shopWithPixels = await getShopWithPixels(shopId);

// 批量获取（返回 Map）
const shopsMap = await batchGetShops(shopIds);
const shop = shopsMap.get(targetId);

// 更新后清除缓存
await updateShop(shopId, data);
invalidateShopCache(shopId);
```

### 转化任务仓库

```typescript
import { 
  getPendingJobs,
  claimJobsForProcessing,
  updateJobStatus,
  cleanupOldJobs,
} from '@/services/db';

// 获取待处理任务
const jobs = await getPendingJobs({
  limit: 100,
  includeRetries: true,
});

// 原子性声明任务
const claimed = await claimJobsForProcessing(
  jobs.map(j => j.id),
  'worker-1'
);

// 更新状态
await updateJobStatus(jobId, {
  status: JobStatus.COMPLETED,
  processedAt: new Date(),
  platformResults: results,
});

// 清理旧数据
const deleted = await cleanupOldJobs(90); // 保留90天
```

### 批量操作

```typescript
import { 
  batchCompleteJobs,
  batchInsertReceipts,
  processInChunks,
} from '@/services/db';

// 批量完成任务（事务）
const result = await batchCompleteJobs([
  { jobId: '1', shopId: 's1', orderId: 'o1', status: 'completed' },
  { jobId: '2', shopId: 's1', orderId: 'o2', status: 'failed', errorMessage: '...' },
]);

console.log(`处理: ${result.processed}, 失败: ${result.failed}`);

// 分块处理大数据集
const result = await processInChunks(
  largeArray,
  100, // 每块100条
  async (chunk) => {
    // 处理每个块
    return await processChunk(chunk);
  }
);
```

---

## React Hooks

### 表单脏状态追踪

```typescript
import { useFormDirty, useMultiFieldDirty } from '@/hooks';

function SettingsForm({ initialData }) {
  const { isDirty, resetToClean, checkDirty } = useFormDirty({
    initialValues: initialData,
  });

  const [name, setName] = useState(initialData.name);

  // 值变化时检查脏状态
  useEffect(() => {
    checkDirty({ name });
  }, [name]);

  // 保存后重置
  const handleSave = async () => {
    await save({ name });
    resetToClean({ name });
  };

  return (
    <Form>
      <TextField value={name} onChange={setName} />
      <Button disabled={!isDirty}>保存</Button>
    </Form>
  );
}
```

### 表单提交

```typescript
import { useSubmitForm, useConfirmSubmit } from '@/hooks';

function DeleteButton() {
  const { confirmAndSubmit, isSubmitting } = useConfirmSubmit({
    message: '确定要删除吗？',
  });

  return (
    <Button
      onClick={() => confirmAndSubmit('delete', { id: '123' })}
      loading={isSubmitting}
    >
      删除
    </Button>
  );
}

function SaveForm() {
  const { submitAction, isSubmitting } = useSubmitForm();

  const handleSave = (data) => {
    submitAction('save', {
      name: data.name,
      enabled: data.enabled,
    });
  };

  return (
    <Button onClick={handleSave} loading={isSubmitting}>
      保存
    </Button>
  );
}
```

---

## 迁移优先级服务

### 计算优先级

```typescript
import {
  calculatePriority,
  calculateAssetPriority,
  type PriorityFactors,
} from '@/services/migration-priority.server';

// 计算单个资产的优先级
const factors: PriorityFactors = {
  riskLevel: 'high',
  impactScope: 'order_status',
  migrationDifficulty: 'easy',
  shopTier: 'plus',
};

const result = calculatePriority(factors);
console.log(`优先级: ${result.priority}/10`);
console.log(`预计时间: ${result.estimatedTimeMinutes} 分钟`);
console.log(`原因:`, result.reasoning);

// 计算数据库中资产的优先级
const assetPriority = await calculateAssetPriority(
  assetId,
  shopTier,
  shopId
);
```

### 生成迁移时间线

```typescript
import { generateMigrationTimeline } from '@/services/migration-priority.server';

const timeline = await generateMigrationTimeline(shopId);

// timeline.assets - 按优先级排序的资产列表
// timeline.totalEstimatedTime - 总预计时间（分钟）
// timeline.assets[].priority - 优先级结果
// timeline.assets[].canStart - 是否可以开始（无阻塞依赖）
// timeline.assets[].blockingDependencies - 阻塞的依赖项
```

### 获取迁移进度

```typescript
import { getMigrationProgress } from '@/services/migration-priority.server';

const progress = await getMigrationProgress(shopId);

// progress.total - 总资产数
// progress.completed - 已完成数
// progress.inProgress - 进行中数
// progress.pending - 待处理数
// progress.completionRate - 完成率（0-100）
```

---

## 监控服务

### 事件成功率监控

```typescript
import {
  calculateSuccessRateByDestination,
  calculateSuccessRateByEventType,
  getSuccessRateHistory,
} from '@/services/monitoring/event-success-rate.server';

// 按平台统计成功率
const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // 最近24小时
const stats = await calculateSuccessRateByDestination(shopId, since);

for (const stat of stats) {
  console.log(`${stat.platform}: ${stat.successRate}%`);
}

// 按事件类型统计成功率
const eventStats = await calculateSuccessRateByEventType(shopId, since);

// 获取历史趋势（按小时）
const history = await getSuccessRateHistory(shopId, 24); // 最近24小时
```

### 缺参率检测

```typescript
import {
  detectMissingParams,
  getMissingParamsStats,
  checkMissingParamsAlerts,
} from '@/services/monitoring/missing-params.server';

// 检测缺失参数
const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
const result = await detectMissingParams(shopId, since, ['value', 'currency']);

console.log(`缺失 value: ${result.missingValue}`);
console.log(`缺失 currency: ${result.missingCurrency}`);

// 获取详细统计
const stats = await getMissingParamsStats(shopId, since, ['value']);

// 检查告警
const alert = checkMissingParamsAlerts(stats, {
  overallThreshold: 0.2, // 20%
  criticalThreshold: 0.5, // 50%
});
```

### 事件量异常检测

```typescript
import {
  detectVolumeAnomaly,
  calculateBaseline,
  checkVolumeDropAlerts,
} from '@/services/monitoring/volume-anomaly.server';

// 检测事件量异常
const anomaly = await detectVolumeAnomaly(shopId, 24); // 最近24小时

if (anomaly.hasAnomaly) {
  console.log(`下降百分比: ${anomaly.dropPercentage}%`);
  console.log(`Z-Score: ${anomaly.zScore}`);
}

// 计算基线
const baseline = await calculateBaseline(shopId, 7); // 7天基线

// 检查告警
const alert = checkVolumeDropAlerts(anomaly, {
  dropThreshold: 0.5, // 50%
  zScoreThreshold: 2.0,
  minVolume: 10, // 最小事件量
});
```

---

## 批量操作服务

### 批量 Audit 扫描

```typescript
import {
  startBatchAudit,
  getBatchAuditStatus,
  getBatchAuditHistory,
  getBatchAuditStatistics,
} from '@/services/batch-audit.server';

// 启动批量扫描
const result = await startBatchAudit({
  groupId: 'group-1',
  requesterId: 'user-1',
  concurrency: 2,
  skipRecentHours: 6,
});

if ('error' in result) {
  console.error(result.error);
} else {
  console.log(`任务ID: ${result.jobId}`);
}

// 获取任务状态
const status = getBatchAuditStatus(jobId);

// 获取历史记录
const history = getBatchAuditHistory(10); // 最近10条

// 获取统计信息
const stats = getBatchAuditStatistics();
```

### 批量应用模板

```typescript
import {
  batchApplyPixelTemplate,
  type BatchApplyOptions,
} from '@/services/workspace/batch-template-apply.server';

const options: BatchApplyOptions = {
  templateId: 'template-1',
  shopIds: ['shop-1', 'shop-2', 'shop-3'],
  overwriteExisting: false,
  skipIfExists: true,
};

const result = await batchApplyPixelTemplate(options);

console.log(`成功: ${result.successCount}`);
console.log(`失败: ${result.failureCount}`);
console.log(`跳过: ${result.skippedCount}`);
```

### 批量报告导出

```typescript
import {
  generateBatchReport,
  type BatchReportOptions,
} from '@/services/workspace/batch-report.server';

const options: BatchReportOptions = {
  shopIds: ['shop-1', 'shop-2'],
  reportType: 'audit',
  includeDetails: true,
  whiteLabel: {
    companyName: 'My Agency',
    logo: 'https://example.com/logo.png',
    contactEmail: 'contact@example.com',
  },
};

const report = await generateBatchReport(options);

if (report) {
  // report.buffer - PDF buffer
  // report.filename - 文件名
  // 可以保存或下载
}
```

---

## 渠道对账服务

### 增强渠道对账

```typescript
import {
  performEnhancedChannelReconciliation,
  getOrderCrossPlatformComparison,
} from '@/services/verification/channel-reconciliation.server';

// 多平台对账
const result = await performEnhancedChannelReconciliation(shopId, 24); // 最近24小时

// result.platforms - 各平台对账结果
// result.discrepancies - 差异分析
//   - missingOrders - 缺失订单数
//   - valueDiscrepancies - 金额差异
//   - duplicateOrders - 重复订单数
// result.crossPlatformConsistency - 跨平台一致性分析

// 订单级跨平台对比
const comparison = await getOrderCrossPlatformComparison(shopId, orderId);

// comparison.platforms - 各平台状态
// comparison.consistent - 是否一致
// comparison.discrepancies - 不一致项
```

---

## 最佳实践

### 1. 类型安全

始终使用类型安全的解析函数处理 JSON 字段：

```typescript
// ❌ 不推荐
const data = job.capiInput as CapiInput;

// ✅ 推荐
const data = parseCapiInput(job.capiInput);
if (!data) {
  logger.warn('无效的 CAPI 输入');
  return;
}
```

### 2. 枚举使用

使用枚举常量而非字符串字面量：

```typescript
// ❌ 不推荐
if (status === 'completed') { ... }

// ✅ 推荐
if (status === JobStatus.COMPLETED) { ... }
```

### 3. 缓存失效

修改数据后记得清除相关缓存：

```typescript
await prisma.shop.update({ where: { id }, data });
invalidateShopCache(id);  // 重要！
```

### 4. 批量操作

对于大量数据操作，使用批量方法：

```typescript
// ❌ 不推荐 - 多次数据库调用
for (const job of jobs) {
  await updateJobStatus(job.id, { status: 'completed' });
}

// ✅ 推荐 - 单次事务
await batchCompleteJobs(jobs.map(j => ({
  jobId: j.id,
  status: 'completed',
})));
```

### 5. 错误处理

使用 Result 模式处理可能失败的操作：

```typescript
// ✅ 推荐
const result = await calculateAssetPriority(assetId, shopTier);
if (!result) {
  logger.warn('资产不存在或计算失败');
  return;
}
```

---

## 更新日志

- **2025-01-XX**: 添加迁移优先级、监控服务、批量操作、渠道对账服务文档
- **2024-12-23**: 初始版本，包含重构后的所有公共 API
