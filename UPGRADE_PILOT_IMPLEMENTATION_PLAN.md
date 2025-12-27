# UpgradePilot 实施计划

> 基于设计方案与当前代码库的差距分析，生成于 2024-12-27

## 📊 总体评估

| 指标 | 状态 |
|------|------|
| **MVP 就绪度** | 🟢 85% |
| **V1 完成度** | 🟡 60% |
| **V2 完成度** | 🔴 20% |
| **上架预计时间** | 1-2 周（修复关键项后） |

---

## 🚨 Phase 0: 上架前必须修复 (P0 - 阻塞上架)

### 0.1 App Store Listing 准备

**状态**: ❌ 未完成

| 任务 | 优先级 | 预计时间 |
|------|--------|----------|
| 应用截图（扫描页、对账页、设置页、TY/OS 模块预览） | P0 | 2h |
| 应用描述（中英文，准确反映功能，不夸大） | P0 | 2h |
| 定价信息规范化（只在指定区域展示） | P0 | 1h |
| 隐私政策页面完善 (`/privacy`) | P0 | 2h |
| 支持文档 / FAQ | P0 | 4h |

### 0.2 合规验证

**状态**: 🟡 部分完成

```bash
# 验证 GDPR Webhooks 是否正常工作
curl -X POST https://your-app.onrender.com/webhooks \
  -H "X-Shopify-Topic: customers/data_request" \
  -H "X-Shopify-Hmac-SHA256: ..." \
  -d '{"shop_domain": "test.myshopify.com", ...}'
```

| 任务 | 当前状态 | 需要修复 |
|------|----------|----------|
| customers/data_request | ✅ 实现 | 验证返回格式 |
| customers/redact | ✅ 实现 | 验证异步处理 |
| shop/redact | ✅ 实现 | 验证清理逻辑 |
| 隐私政策链接 | ✅ 存在 | 检查措辞合规 |
| 数据保留说明 | ⚠️ 需补充 | 添加到 UI |

### 0.3 关键流程验证清单

```markdown
[ ] 新店安装 → OAuth → webhooks 注册 → 首次扫描
[ ] 重装流程（卸载后重装，数据保留策略）
[ ] 卸载流程 → webhooks 解除 → pixel 停用
[ ] 测试订单 → webhook 接收 → 对账 PASS
[ ] 不同主题下 TY/OS 模块渲染正常
[ ] 不同货币/时区店铺工作正常
```

---

## 🟢 Phase 1: MVP 增强 (上架后 2-4 周)

### 1.1 事件对账增强 ⭐ 高优先级

**当前状态**: 基础实现（Webhook vs Pixel Receipt 匹配）

**需要增加**:

```typescript
// app/services/reconciliation.server.ts - 增强版对账

interface EnhancedReconciliationResult {
  // 已有
  webhookReceived: boolean;
  pixelReceiptFound: boolean;
  
  // 需要增加
  parameterCompleteness: {
    hasCurrency: boolean;
    hasValue: boolean;
    hasItems: boolean;
    hasEventId: boolean;
  };
  deduplicationStatus: 'unique' | 'duplicate' | 'unknown';
  consentEvidence: {
    hasConsent: boolean;
    consentSource: 'pixel' | 'webhook' | 'none';
    marketingAllowed: boolean;
    analyticsAllowed: boolean;
  };
  qualityScore: number; // 0-100
  recommendations: string[];
}
```

**预计工时**: 8h

### 1.2 迁移配方执行器完善

**当前状态**: 配方定义完整，执行器基础实现

**需要增加**:

```typescript
// app/services/recipes/executor.ts - 增强

export async function executeRecipe(
  shopId: string,
  recipeId: string,
  config: Record<string, unknown>
): Promise<RecipeExecutionResult> {
  const recipe = getRecipeById(recipeId);
  
  // 需要实现的步骤
  for (const step of recipe.steps) {
    switch (step.actionType) {
      case 'auto':
        // 自动执行：webPixelCreate/webPixelUpdate
        await executeAutoStep(shopId, step);
        break;
      case 'config':
        // 配置保存：PixelConfig 表更新
        await saveConfigStep(shopId, recipeId, config);
        break;
      case 'manual':
        // 记录状态，等待用户确认
        await markStepPending(shopId, recipeId, step.order);
        break;
    }
  }
  
  // 记录 AppliedRecipe
  return await prisma.appliedRecipe.update(...);
}
```

**预计工时**: 12h

### 1.3 报告导出功能

**当前状态**: 基础 JSON API 存在

**需要增加**:

```typescript
// app/routes/api.exports.tsx - 增强

// 支持格式
type ExportFormat = 'json' | 'csv' | 'pdf';

// CSV 导出
function exportToCsv(data: ScanReport): string {
  // 实现 CSV 格式化
}

// PDF 导出 (使用 @react-pdf/renderer 或 puppeteer)
async function exportToPdf(data: ScanReport): Promise<Buffer> {
  // 实现 PDF 生成
}
```

**预计工时**: 8h

### 1.4 通用 Webhook 连接器增强

**当前状态**: 基础实现

**需要增加**:

```typescript
// app/services/platforms/webhook.service.ts - 增强

interface WebhookTemplate {
  name: string;
  payloadTemplate: string; // JSON 模板，支持 {{variable}} 占位符
  headers: Record<string, string>;
  authType: 'none' | 'bearer' | 'basic' | 'custom_header';
}

// 预置模板
const WEBHOOK_TEMPLATES = {
  generic: { ... },
  zapier: { ... },
  make: { ... },
  n8n: { ... },
};
```

**预计工时**: 6h

---

## 🟡 Phase 2: V1 完整版 (4-8 周)

### 2.1 多环境支持

**数据模型已存在**: `PlatformEnvironment` 表

**需要实现**:

```typescript
// app/routes/app.settings.tsx - 增强

// 环境切换 UI
<Select
  label="当前环境"
  options={[
    { label: '生产环境', value: 'production' },
    { label: '测试环境', value: 'test' },
  ]}
  value={currentEnv}
  onChange={handleEnvChange}
/>

// 灰度发布
<RangeSlider
  label="流量百分比"
  value={trafficPercentage}
  min={0}
  max={100}
  onChange={handleTrafficChange}
/>
```

### 2.2 高级对账报告

```typescript
// app/services/reconciliation.server.ts - V1 增强

interface AdvancedReconciliationReport {
  // 参数完整性分析
  parameterAnalysis: {
    missingCurrency: number;
    missingValue: number;
    zeroValueOrders: number;
    missingItems: number;
  };
  
  // 去重分析
  deduplicationAnalysis: {
    duplicateEvents: number;
    uniqueEvents: number;
    deduplicationRate: number;
  };
  
  // 同意管理分析
  consentAnalysis: {
    withConsent: number;
    withoutConsent: number;
    marketingBlocked: number;
    analyticsBlocked: number;
  };
  
  // 修复建议
  fixRecommendations: FixRecommendation[];
}
```

### 2.3 Pinterest/Snapchat 连接器

```typescript
// app/services/platforms/pinterest.service.ts - 新增

export class PinterestPlatformService extends BasePlatformService {
  async sendConversion(data: ConversionData, eventId: string): Promise<PlatformResult> {
    // Pinterest Conversions API
    // https://developers.pinterest.com/docs/conversions/conversions/
  }
}

// app/services/platforms/snapchat.service.ts - 新增

export class SnapchatPlatformService extends BasePlatformService {
  async sendConversion(data: ConversionData, eventId: string): Promise<PlatformResult> {
    // Snapchat Conversions API
    // https://businesshelp.snapchat.com/s/article/conversions-api
  }
}
```

### 2.4 Agency 多店铺管理

**数据模型已存在**: `ShopGroup`, `ShopGroupMember` 表

**需要实现**:

```typescript
// app/routes/app.agency.tsx - 新增

export default function AgencyDashboard() {
  return (
    <Page title="代理仪表盘">
      {/* 店铺列表 */}
      <ShopGroupList />
      
      {/* 批量操作 */}
      <BatchOperations>
        <Button onClick={handleBatchScan}>批量扫描</Button>
        <Button onClick={handleBatchExport}>批量导出</Button>
        <Button onClick={handleBatchMigrate}>批量迁移</Button>
      </BatchOperations>
      
      {/* 汇总报告 */}
      <AggregateDashboard />
    </Page>
  );
}
```

---

## 🔴 Phase 3: V2 差异化护城河 (8-16 周)

### 3.1 Server-side EventBridge

```typescript
// app/services/event-bridge.server.ts - 企业版

interface EventBridgeConfig {
  type: 'aws_eventbridge' | 'google_pubsub' | 'azure_eventgrid';
  config: Record<string, unknown>;
}

export async function publishToEventBridge(
  event: ConversionEvent,
  config: EventBridgeConfig
): Promise<void> {
  // 实现多云事件桥
}
```

### 3.2 归因质量评分系统

```typescript
// app/services/attribution-score.server.ts - 新增

interface AttributionScoreResult {
  overallScore: number; // 0-100
  
  // 分项得分
  breakdown: {
    eventCoverage: number;      // 事件覆盖率
    parameterQuality: number;   // 参数质量
    deduplicationHealth: number; // 去重健康度
    latencyScore: number;       // 延迟评分
    consentCompliance: number;  // 同意合规度
  };
  
  // 改进建议
  improvements: Improvement[];
  
  // 与行业基准比较
  benchmarkComparison: {
    industryAverage: number;
    percentile: number;
  };
}
```

### 3.3 Agency 协作工作流

```typescript
// app/routes/app.agency.workflows.tsx - 新增

// 批量导入店铺
async function importShopsFromCsv(file: File): Promise<ImportResult> {
  // 解析 CSV，批量安装
}

// 自动生成交付包
async function generateDeliveryPackage(
  groupId: string
): Promise<DeliveryPackage> {
  return {
    scanReports: await batchExportScans(groupId),
    migrationPlans: await batchGeneratePlans(groupId),
    brandedPdf: await generateBrandedReport(groupId),
    teamNotes: await getTeamNotes(groupId),
  };
}

// 工单系统集成
interface TicketIntegration {
  type: 'zendesk' | 'freshdesk' | 'intercom' | 'custom';
  autoCreateOnFail: boolean;
  assignee: string;
}
```

---

## 📋 实施优先级矩阵

| 功能 | 影响 | 复杂度 | 优先级 | 建议时间 |
|------|------|--------|--------|----------|
| App Store Listing | 🔴 阻塞上架 | 低 | P0 | 本周 |
| GDPR 验证 | 🔴 阻塞上架 | 低 | P0 | 本周 |
| 安装/卸载流程验证 | 🔴 阻塞上架 | 低 | P0 | 本周 |
| 事件对账增强 | 🟡 提升价值 | 中 | P1 | 2周内 |
| 报告导出 | 🟡 提升价值 | 中 | P1 | 2周内 |
| 配方执行器 | 🟡 核心功能 | 中 | P1 | 3周内 |
| 多环境支持 | 🟢 增值 | 高 | P2 | 4-6周 |
| Pinterest/Snapchat | 🟢 扩展 | 中 | P2 | 4-6周 |
| Agency 多店铺 | 🟢 ARPU | 高 | P2 | 6-8周 |
| EventBridge | 🔵 企业版 | 高 | P3 | 8-12周 |
| 归因评分 | 🔵 护城河 | 高 | P3 | 10-14周 |

---

## 🎯 验收标准 (Definition of Done)

### MVP 上架验收

- [ ] 新店安装后 15 分钟内可完成完整流程
- [ ] 扫描生成准确的风险报告
- [ ] GA4/Meta 至少一个平台 CAPI 发送成功
- [ ] TY/OS 模块正常渲染
- [ ] 测试订单对账 PASS
- [ ] 卸载后清理完整

### V1 验收

- [ ] 所有配方可一键执行
- [ ] 对账报告包含参数完整性分析
- [ ] CSV/PDF 导出功能正常
- [ ] 多环境切换无数据丢失
- [ ] Pinterest/Snapchat 事件发送成功

### V2 验收

- [ ] Agency 可管理 10+ 店铺
- [ ] 批量导出 100+ 报告 < 5 分钟
- [ ] EventBridge 集成测试通过
- [ ] 归因评分与实际效果相关性 > 70%

---

## 🚀 快速启动命令

```bash
# 1. 验证当前状态
pnpm run test

# 2. 本地开发
pnpm run dev

# 3. 部署到 Render
git push origin main

# 4. 检查 Shopify CLI 配置
shopify app info

# 5. 部署扩展
pnpm run deploy
```

---

## 📞 下一步行动

1. **立即**: 完成 App Store Listing 材料准备
2. **本周**: 完成合规验证和流程测试
3. **下周**: 提交 Shopify App Store 审核
4. **持续**: 根据用户反馈迭代 V1 功能

---

*文档生成时间: 2024-12-27*
*基于 tracking-guardian 代码库分析*

