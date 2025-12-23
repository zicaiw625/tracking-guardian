# API Reference

本文档描述了重构后代码库的公共 API 和使用方式。

## 目录

1. [类型系统](#类型系统)
2. [Schema 验证](#schema-验证)
3. [平台服务](#平台服务)
4. [数据库操作](#数据库操作)
5. [React Hooks](#react-hooks)

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

---

## 更新日志

- **2024-12-23**: 初始版本，包含重构后的所有公共 API

