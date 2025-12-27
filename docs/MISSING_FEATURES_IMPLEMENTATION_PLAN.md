# 缺失功能实现计划

> 基于设计方案 v1.0 与当前代码库对比分析
> 生成日期: 2024-12-28
> 更新日期: 2024-12-28 (全部实现)

---

## ✅ 功能实现状态

| 优先级 | 功能模块 | 当前状态 | 实现文件 |
|--------|---------|---------|----------|
| P0 | Agency 批量 Audit | ✅ 已完成 | `app/services/batch-audit.server.ts` |
| P0 | Agency 批量像素模板 | ✅ 已完成 | `app/services/batch-pixel-config.server.ts` |
| P1 | PDF 报告导出 | ✅ 已完成 | `app/services/pdf-generator.server.ts` |
| P1 | Pinterest 像素模板 UI | ✅ 已完成 | `app/routes/settings/_components/ServerTrackingTab.tsx` |
| P2 | 订单追踪对接 (AfterShip) | ✅ 已完成 | `app/services/tracking-providers/` |
| P2 | Workspace 邀请流程 | ✅ 已完成 | `app/services/workspace-invitation.server.ts` |
| P2 | 加载状态组件 | ✅ 已完成 | `app/components/ui/LoadingSpinner.tsx` |

---

## 📋 功能缺口总览 (历史参考)

| 优先级 | 功能模块 | 当前状态 | 预计工时 | 依赖 |
|--------|---------|---------|---------|------|
| P0 | Agency 批量 Audit | ~~服务层待实现~~ ✅ | 3-4 天 | - |
| P0 | Agency 批量像素模板 | ~~服务层待实现~~ ✅ | 2-3 天 | 批量 Audit |
| P1 | PDF 报告导出 | ~~未实现~~ ✅ | 2 天 | - |
| P1 | Pinterest 像素模板 UI | ~~服务端已完成~~ ✅ | 1 天 | - |
| P2 | 订单追踪对接 (AfterShip) | ~~UI 已有，API 待接~~ ✅ | 2-3 天 | - |
| P2 | Workspace 邀请流程 | ~~数据模型已有~~ ✅ | 2 天 | - |

---

## 🔴 P0 - Agency 批量功能

### 1. 批量 Audit 服务

**目标**: Agency 用户可一键对工作区内所有店铺运行 Audit 扫描

**文件位置**: `app/services/batch-audit.server.ts`

```typescript
// 接口设计
export interface BatchAuditOptions {
  groupId: string;
  requesterId: string;
  includeManualAnalysis?: boolean;
}

export interface BatchAuditResult {
  groupId: string;
  totalShops: number;
  completedShops: number;
  failedShops: number;
  results: Array<{
    shopId: string;
    shopDomain: string;
    status: 'success' | 'failed' | 'skipped';
    scanReportId?: string;
    riskScore?: number;
    identifiedPlatforms?: string[];
    error?: string;
  }>;
  summary: {
    avgRiskScore: number;
    highRiskCount: number;
    platformBreakdown: Record<string, number>;
  };
}

// 核心函数
export async function runBatchAudit(options: BatchAuditOptions): Promise<BatchAuditResult>;
export async function getBatchAuditStatus(jobId: string): Promise<BatchAuditResult | null>;
```

**实现步骤**:

1. [ ] 创建 `app/services/batch-audit.server.ts`
2. [ ] 添加权限检查（仅 Agency 套餐可用）
3. [ ] 实现并行扫描（使用 Promise.allSettled，限制并发数）
4. [ ] 添加进度追踪（可选：WebSocket 或轮询）
5. [ ] 在 `app.workspace.tsx` 添加批量 Audit 按钮和状态显示

**测试用例**:
```typescript
// tests/services/batch-audit.test.ts
describe('BatchAuditService', () => {
  it('should run audit on all group shops');
  it('should respect concurrency limit');
  it('should handle partial failures gracefully');
  it('should calculate correct summary stats');
});
```

---

### 2. 批量像素模板应用

**目标**: Agency 用户可批量为多个店铺应用相同的像素配置模板

**文件位置**: `app/services/batch-pixel-config.server.ts`

```typescript
// 接口设计
export interface PixelTemplate {
  id: string;
  name: string;
  platforms: Array<{
    platform: 'google' | 'meta' | 'tiktok' | 'pinterest';
    eventMappings?: Record<string, string>;
    // 凭证需单独配置，模板只包含结构
  }>;
}

export interface BatchApplyOptions {
  groupId: string;
  requesterId: string;
  templateId: string;
  targetShopIds: string[];
  overwriteExisting?: boolean;
}

export interface BatchApplyResult {
  totalShops: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  details: Array<{
    shopId: string;
    shopDomain: string;
    status: 'applied' | 'failed' | 'skipped';
    reason?: string;
  }>;
}

// 核心函数
export async function createPixelTemplate(creatorId: string, template: Omit<PixelTemplate, 'id'>): Promise<PixelTemplate>;
export async function listPixelTemplates(ownerId: string): Promise<PixelTemplate[]>;
export async function batchApplyTemplate(options: BatchApplyOptions): Promise<BatchApplyResult>;
```

**数据模型扩展** (添加到 `prisma/schema.prisma`):

```prisma
model PixelTemplate {
  id        String   @id @default(cuid())
  ownerId   String   // 创建者店铺 ID
  name      String
  platforms Json     // 平台配置结构（不含凭证）
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([ownerId])
}
```

**实现步骤**:

1. [ ] 添加 `PixelTemplate` 模型到 Prisma schema
2. [ ] 创建 `app/services/batch-pixel-config.server.ts`
3. [ ] 在 Workspace 页面添加"模板管理"Tab
4. [ ] 实现模板创建/编辑 Modal
5. [ ] 实现批量应用 UI（选择店铺 -> 选择模板 -> 确认）

---

## 🟠 P1 - 报告导出与 Pinterest UI

### 3. PDF 报告导出

**目标**: 生成可下载的 PDF 格式迁移验收报告

**方案选择**:

| 方案 | 优点 | 缺点 | 推荐 |
|------|-----|------|------|
| jsPDF + html2canvas | 纯前端，无服务端依赖 | 样式还原度一般 | 快速实现 |
| Puppeteer | 样式完美还原 | 需要 Chromium，资源占用大 | 高保真 |
| @react-pdf/renderer | React 原生，服务端渲染 | 学习曲线，样式受限 | 平衡 |

**推荐方案**: 使用 `@react-pdf/renderer` 服务端生成

**文件位置**: `app/services/report-generator.server.ts` (已存在，需扩展)

**实现步骤**:

1. [ ] 安装依赖: `pnpm add @react-pdf/renderer`
2. [ ] 创建 `app/components/reports/VerificationReportPDF.tsx`
3. [ ] 扩展 `report-generator.server.ts` 添加 PDF 生成函数
4. [ ] 在 `app/routes/api.exports.tsx` 添加 `format=pdf` 支持
5. [ ] 在 Workspace 报告页和验收页添加 PDF 导出按钮

**报告模板结构**:
```
┌─────────────────────────────────────┐
│ 🛡️ Tracking Guardian               │
│ 迁移验收报告                         │
│ 生成时间: 2024-12-28                │
├─────────────────────────────────────┤
│ 店铺信息                            │
│ - 域名: example.myshopify.com      │
│ - 套餐: Pro                         │
│ - 验收状态: ✅ 通过                  │
├─────────────────────────────────────┤
│ 验收概要                            │
│ ┌───────┬───────┬───────┐          │
│ │ 通过率 │ 参数完整率 │ 金额准确率 │   │
│ │ 95%   │ 100%    │ 98%      │   │
│ └───────┴───────┴───────┘          │
├─────────────────────────────────────┤
│ 平台详情                            │
│ - GA4: ✅ 已配置, 12 events sent   │
│ - Meta: ✅ 已配置, 12 events sent  │
│ - TikTok: ⚠️ 未配置                │
├─────────────────────────────────────┤
│ 事件明细 (最近 10 条)               │
│ ...                                 │
└─────────────────────────────────────┘
```

---

### 4. Pinterest 像素模板 UI

**目标**: 在迁移页面添加 Pinterest 配置入口

**当前状态**: 服务端 `pinterest.service.ts` 已完整实现 CAPI

**缺失部分**: 前端配置 UI

**文件修改**: `app/routes/app.migrate.tsx`

**实现步骤**:

1. [ ] 在平台选择列表中添加 Pinterest 选项
2. [ ] 创建 Pinterest 凭证配置表单:
   - Ad Account ID (数字)
   - Access Token
   - Test Mode 开关
3. [ ] 复用现有的凭证加密存储逻辑
4. [ ] 在 `app/routes/settings/` 添加 Pinterest Tab

**UI 组件**:
```tsx
// app/components/forms/PinterestConfigForm.tsx
interface PinterestConfigFormProps {
  config?: {
    adAccountId: string;
    hasAccessToken: boolean;
    testMode: boolean;
  };
  onSave: (data: PinterestCredentialsInput) => void;
  isLoading: boolean;
}
```

---

## 🟡 P2 - 增强功能

### 5. 订单追踪对接 (AfterShip/17Track)

**目标**: ShippingTracker UI Extension 可显示真实物流状态

**当前状态**: UI 已实现，显示静态数据

**方案设计**:

```typescript
// app/services/tracking-providers/interface.ts
export interface TrackingProvider {
  name: string;
  getTrackingInfo(trackingNumber: string, carrier?: string): Promise<TrackingInfo>;
}

export interface TrackingInfo {
  status: 'pending' | 'in_transit' | 'delivered' | 'exception';
  lastUpdate: Date;
  location?: string;
  events: Array<{
    date: Date;
    description: string;
    location?: string;
  }>;
}

// app/services/tracking-providers/aftership.ts
export class AfterShipProvider implements TrackingProvider { ... }

// app/services/tracking-providers/track17.ts
export class Track17Provider implements TrackingProvider { ... }
```

**实现步骤**:

1. [ ] 创建 `app/services/tracking-providers/` 目录
2. [ ] 实现 AfterShip API 对接 (需要 API Key)
3. [ ] 在 UiExtensionSetting 中添加 tracking_provider 配置
4. [ ] 创建 `/api/tracking` 端点供 Extension 调用
5. [ ] 更新 `ShippingTracker.tsx` 调用真实 API

**注意事项**:
- AfterShip 免费版有调用限制 (100 次/月)
- 需要商家自行注册 AfterShip 账号并提供 API Key
- 考虑添加缓存减少 API 调用

---

### 6. Workspace 邀请流程

**目标**: Agency 用户可通过邮箱邀请其他店铺加入 Workspace

**当前状态**: 
- `WorkspaceMember` 模型已定义
- 邀请状态字段已有 (`inviteStatus`, `invitedAt`, `acceptedAt`)
- UI 逻辑未实现

**实现步骤**:

1. [ ] 创建 `app/services/workspace-invite.server.ts`
2. [ ] 实现邀请邮件发送 (使用现有 Resend 集成)
3. [ ] 创建 `/app/workspace/invite/[token]` 接受邀请页面
4. [ ] 在 Workspace 页面添加"邀请成员"按钮
5. [ ] 添加邀请记录列表和状态管理

**邮件模板**:
```
主题: [Tracking Guardian] 您被邀请加入 {workspace_name}

正文:
{inviter_email} 邀请您加入 "{workspace_name}" 工作区。

加入后，您可以：
- 查看汇总追踪报告
- 协作管理多店迁移
- 共享像素配置模板

点击以下链接接受邀请：
{accept_url}

此链接 7 天内有效。
```

---

## 📁 文件结构变更

```
app/
├── services/
│   ├── batch-audit.server.ts          # 新增
│   ├── batch-pixel-config.server.ts   # 新增
│   ├── workspace-invite.server.ts     # 新增
│   ├── tracking-providers/            # 新增目录
│   │   ├── interface.ts
│   │   ├── aftership.ts
│   │   └── track17.ts
│   └── report-generator.server.ts     # 扩展 PDF 生成
├── components/
│   ├── forms/
│   │   └── PinterestConfigForm.tsx    # 新增
│   └── reports/
│       └── VerificationReportPDF.tsx  # 新增
├── routes/
│   ├── app.workspace.tsx              # 扩展批量功能
│   ├── app.workspace.invite.$token.tsx # 新增
│   └── api.tracking.tsx               # 新增
└── ...

prisma/
└── schema.prisma                       # 添加 PixelTemplate 模型
```

---

## 🗓️ 实施时间线

### Week 1: P0 功能
| 天 | 任务 | 产出 |
|----|------|------|
| D1 | 批量 Audit 服务层 | `batch-audit.server.ts` |
| D2 | 批量 Audit UI | Workspace 页面集成 |
| D3 | PixelTemplate 模型 + 服务 | `batch-pixel-config.server.ts` |
| D4 | 批量模板 UI | 模板管理 + 批量应用 |
| D5 | 测试 + 修复 | P0 功能完成 |

### Week 2: P1 + P2 功能
| 天 | 任务 | 产出 |
|----|------|------|
| D1 | PDF 报告生成 | `@react-pdf/renderer` 集成 |
| D2 | PDF 导出 UI | 多处添加导出按钮 |
| D3 | Pinterest UI | 迁移页 + 设置页集成 |
| D4 | 订单追踪对接 | AfterShip Provider |
| D5 | Workspace 邀请 | 邀请流程 + 邮件 |

---

## ✅ 验收标准

### P0 批量功能
- [ ] Agency 用户可在 Workspace 页面一键运行批量 Audit
- [ ] 批量 Audit 结果显示每个店铺的风险分数和平台检测
- [ ] 可创建/管理像素配置模板
- [ ] 可选择多个店铺批量应用模板
- [ ] 批量操作有进度显示和错误处理

### P1 报告 + Pinterest
- [ ] 可在验收页、Workspace 报告页导出 PDF
- [ ] PDF 包含店铺信息、验收概要、平台详情、事件明细
- [ ] 迁移页面显示 Pinterest 选项
- [ ] Pinterest 凭证可配置和验证
- [ ] Pinterest CAPI 发送正常工作

### P2 增强功能
- [ ] ShippingTracker 可显示真实物流状态 (配置 AfterShip 后)
- [ ] 可通过邮箱邀请其他店铺加入 Workspace
- [ ] 被邀请者可接受/拒绝邀请
- [ ] 邀请记录可在 Workspace 页面查看

---

## 🔗 相关文档

- [设计方案原文](../README.md)
- [API 参考](./API_REFERENCE.md)
- [Pinterest CAPI 文档](https://developers.pinterest.com/docs/api/v5/#tag/conversion_events)
- [AfterShip API 文档](https://www.aftership.com/docs/tracking/quickstart)

