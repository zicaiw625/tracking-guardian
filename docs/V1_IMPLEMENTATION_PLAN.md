# Checkout 升级助手 v1.0 实施计划

## 项目概述

本文档基于提供的设计方案，对比现有代码库，制定详细的实施计划，确保应用能够上架 Shopify App Store 并实现商业化。

## 一、现状评估

### 1.1 已实现功能 ✅

#### Audit（扫描与风险报告）
- ✅ **基础扫描功能**：`app/services/scanner/` 已实现 ScriptTags 和 Web Pixels 扫描
- ✅ **AuditAsset 模型**：数据库模型已存在，支持多种来源类型和分类
- ✅ **风险评分**：`risk-assessment.ts` 已实现风险评估逻辑
- ✅ **扫描报告页面**：`app/routes/app.scan.tsx` 已实现完整的扫描报告 UI
- ⚠️ **待增强**：手动粘贴脚本分析、更详细的迁移建议

#### 像素迁移中心
- ✅ **像素配置模型**：`PixelConfig` 已支持多平台（GA4/Meta/TikTok/Pinterest）
- ✅ **迁移向导**：`PixelMigrationWizard` 组件已实现
- ✅ **环境切换**：`PixelConfig.environment` 字段已支持 test/live
- ✅ **配置版本**：`configVersion` 和 `previousConfig` 已支持回滚
- ✅ **事件映射**：`eventMappings` 字段已支持自定义映射
- ⚠️ **待增强**：批量应用模板、Agency 多店支持

#### Verification（验收）
- ✅ **完整实现**：`app/services/verification.server.ts` 和 `app/routes/app.verification.tsx` 已完整实现
- ✅ **测试清单**：`VERIFICATION_TEST_ITEMS` 已定义测试项
- ✅ **报告导出**：支持 CSV/JSON 导出
- ✅ **实时监控**：`RealtimeEventMonitor` 组件已实现
- ✅ **历史记录**：验收历史查询已实现

#### UI 模块库
- ✅ **多个模块**：Survey, Support, ShippingTracker, UpsellOffer, Reorder 已实现
- ✅ **UI Extension 配置**：`shopify.extension.toml` 已配置所有模块
- ✅ **数据库模型**：`UiExtensionSetting` 已支持模块配置
- ⚠️ **待增强**：模块管理界面、批量配置、Agency 模板

#### 监控与告警
- ✅ **转化日志**：`ConversionLog` 已实现
- ✅ **对账报告**：`ReconciliationReport` 已实现
- ✅ **告警配置**：`AlertConfig` 已支持多通道告警
- ✅ **监控页面**：`app/routes/app.monitor.tsx` 已实现

#### 商业化
- ✅ **计费系统**：`app/services/billing/` 已完整实现
- ✅ **订阅管理**：支持创建/取消订阅
- ✅ **套餐定义**：`BILLING_PLANS` 已定义
- ✅ **权限控制**：`checkBillingGate` 已实现功能限制
- ⚠️ **待调整**：套餐定义需要对齐设计方案

#### Agency 多店支持
- ✅ **数据库模型**：`Workspace`, `WorkspaceMember`, `WorkspaceShop` 已存在
- ⚠️ **待实现**：Workspace 管理界面、批量操作、权限控制

### 1.2 缺失功能 ❌

1. **安装后自动体检**：需要实现安装完成后的自动扫描和迁移清单生成
2. **手动脚本粘贴分析**：需要增强 Audit 功能，支持手动粘贴脚本内容分析
3. **Workspace 管理界面**：需要实现多店工作区的完整 UI
4. **批量像素模板应用**：需要实现 Agency 批量应用像素配置
5. **模块配置管理界面**：需要实现 UI 模块的集中管理界面
6. **套餐对齐**：需要调整套餐定义以匹配设计方案

## 二、实施优先级

### P0（必须实现，上架前完成）

1. **安装后自动体检**（Flow A）
   - 安装完成时自动运行扫描
   - 生成迁移清单和优先级建议
   - Dashboard 显示风险分数和升级状态

2. **套餐定义对齐**
   - 调整 `BILLING_PLANS` 以匹配设计方案
   - 实现功能权限控制（gating）

3. **手动脚本粘贴分析增强**
   - 在 Audit 页面添加手动粘贴输入框
   - 增强内容分析，识别更多平台和风险

### P1（重要功能，MVP 可收费）

4. **Workspace 管理界面**
   - 创建工作区
   - 添加/移除店铺
   - 成员管理（Owner/Admin/Viewer）

5. **批量像素模板应用**
   - 创建像素模板
   - 批量应用到多个店铺
   - 模板库管理

6. **模块配置管理界面**
   - UI 模块启用/禁用
   - 模块配置集中管理
   - 预览功能

### P2（增强功能，后续迭代）

7. **高级 Audit 功能**
   - ML 辅助识别（可选）
   - 更详细的迁移建议
   - 迁移进度跟踪

8. **Agency 报告导出**
   - PDF 报告生成
   - 批量导出迁移验收报告
   - 白标报告

## 三、详细实施计划

### Phase 1: 安装后自动体检（P0）

#### 3.1.1 实现自动扫描 Hook

**文件**：`app/hooks/after-auth.server.ts`（新建）

```typescript
// 安装后自动运行扫描
export async function runPostInstallScan(shopId: string, admin: AdminApiContext) {
  // 1. 运行基础扫描
  // 2. 检查升级状态
  // 3. 生成迁移清单
  // 4. 计算风险分数
}
```

#### 3.1.2 Dashboard 增强

**文件**：`app/routes/app._index.tsx`

- 添加风险分数显示
- 添加升级状态 Banner
- 添加迁移清单预览
- 添加 CTA：开始 Audit / 开始迁移

#### 3.1.3 迁移清单生成

**文件**：`app/services/migration-checklist.server.ts`（新建）

- 基于 AuditAsset 生成迁移清单
- 计算优先级
- 估算迁移时间

### Phase 2: 套餐定义对齐（P0）

#### 3.2.1 调整套餐定义

**文件**：`app/services/billing/plans.ts`

根据设计方案调整：

```typescript
export const BILLING_PLANS = {
  free: {
    name: "Free",
    price: 0,
    monthlyOrderLimit: 0, // 无限制（仅扫描）
    features: {
      audit: true,
      migrationChecklist: true,
      // ...
    }
  },
  starter: {
    name: "Starter",
    price: 29,
    monthlyOrderLimit: 1000,
    features: {
      // 1 个目的地像素
      // 1 个页面模块
      // 基础验收
    }
  },
  growth: {
    name: "Growth",
    price: 79,
    monthlyOrderLimit: 10000,
    features: {
      // 3 个目的地像素
      // 全部页面模块
      // 事件对账 + 告警
    }
  },
  agency: {
    name: "Agency",
    price: 199,
    monthlyOrderLimit: 50000,
    features: {
      // 多店 workspace
      // 批量交付 + 报告导出
    }
  }
}
```

#### 3.2.2 功能权限控制

**文件**：`app/utils/plans.ts`

- 实现 `isPlanAtLeast` 函数
- 实现 `checkFeatureAccess` 函数
- 在关键页面添加权限检查

### Phase 3: 手动脚本粘贴分析增强（P0）

#### 3.3.1 Audit 页面增强

**文件**：`app/routes/app.scan.tsx`

- 添加"手动粘贴脚本"输入框
- 添加"分析脚本"按钮
- 显示分析结果并创建 AuditAsset

#### 3.3.2 内容分析增强

**文件**：`app/services/scanner/content-analysis.ts`

- 增强平台识别（更多正则表达式）
- 增强风险检测（PII、阻塞加载等）
- 生成迁移建议

### Phase 4: Workspace 管理界面（P1）

#### 3.4.1 Workspace 列表页面

**文件**：`app/routes/app.workspace.tsx`（已存在，需增强）

- 显示所有工作区
- 创建工作区按钮
- 工作区详情卡片

#### 3.4.2 Workspace 详情页面

**文件**：`app/routes/app.workspace.$id.tsx`（新建）

- 店铺列表
- 成员管理
- 批量操作按钮
- 权限设置

#### 3.4.3 Workspace 服务

**文件**：`app/services/workspace.server.ts`（新建）

- `createWorkspace`
- `addShopToWorkspace`
- `removeShopFromWorkspace`
- `inviteMember`
- `updateMemberRole`

### Phase 5: 批量像素模板应用（P1）

#### 3.5.1 像素模板管理

**文件**：`app/routes/app.workspace.templates.tsx`（已存在，需增强）

- 模板列表
- 创建模板
- 应用模板到多个店铺

#### 3.5.2 批量应用服务

**文件**：`app/services/batch-pixel-apply.server.ts`（已存在，需增强）

- 支持从模板应用
- 批量操作进度显示
- 错误处理

### Phase 6: 模块配置管理界面（P1）

#### 3.6.1 UI 模块管理页面

**文件**：`app/routes/app.ui-blocks.tsx`（已存在，需增强）

- 模块列表（启用/禁用状态）
- 模块配置表单
- 预览功能
- 批量启用/禁用

#### 3.6.2 模块配置服务

**文件**：`app/services/ui-extension.server.ts`（已存在，需增强）

- `enableModule`
- `disableModule`
- `updateModuleSettings`
- `getModuleStatus`

## 四、数据库迁移

### 4.1 现有模型检查

所有必要的数据库模型已存在：
- ✅ `AuditAsset`
- ✅ `VerificationRun`
- ✅ `UiExtensionSetting`
- ✅ `Workspace`, `WorkspaceMember`, `WorkspaceShop`
- ✅ `PixelTemplate`

### 4.2 可能需要的新字段

检查是否需要添加：

1. **Shop 表**
   - `onboardingCompleted`: 是否完成引导
   - `lastScanAt`: 最后扫描时间

2. **AuditAsset 表**
   - 可能需要添加 `manualContent` 字段（加密存储手动粘贴的内容）

## 五、API 权限检查

### 5.1 当前权限

根据 `README.md`，当前申请的权限：
- `read_orders`
- `read_script_tags`
- `read_pixels`
- `write_pixels`
- `read_customer_events`

### 5.2 权限评估

所有权限都有明确的业务理由，符合最小权限原则。

## 六、测试计划

### 6.1 单元测试

- [ ] Audit 扫描服务测试
- [ ] Verification 服务测试
- [ ] Workspace 服务测试
- [ ] 批量应用服务测试

### 6.2 集成测试

- [ ] 安装流程 E2E 测试
- [ ] 像素迁移流程 E2E 测试
- [ ] 验收流程 E2E 测试
- [ ] Workspace 操作 E2E 测试

### 6.3 验收测试

- [ ] 套餐权限控制测试
- [ ] 功能限制测试
- [ ] 多店操作测试

## 七、上架准备

### 7.1 App Store Listing

- [ ] 应用名称和描述
- [ ] 截图和视频
- [ ] 数据使用说明
- [ ] 隐私政策链接

### 7.2 审核检查清单

- [ ] GraphQL Admin API 使用（已符合）
- [ ] Session token 使用（已符合）
- [ ] 最小权限原则（已符合）
- [ ] 隐私合规（已符合）
- [ ] 错误处理完善
- [ ] 卸载流程清理数据

## 八、时间估算

### Phase 1: 安装后自动体检（P0）
- **时间**：3-5 天
- **人员**：1 名全栈开发

### Phase 2: 套餐定义对齐（P0）
- **时间**：2-3 天
- **人员**：1 名全栈开发

### Phase 3: 手动脚本粘贴分析增强（P0）
- **时间**：2-3 天
- **人员**：1 名全栈开发

### Phase 4: Workspace 管理界面（P1）
- **时间**：5-7 天
- **人员**：1 名全栈开发

### Phase 5: 批量像素模板应用（P1）
- **时间**：3-5 天
- **人员**：1 名全栈开发

### Phase 6: 模块配置管理界面（P1）
- **时间**：3-5 天
- **人员**：1 名全栈开发

### 总计（P0 + P1）
- **时间**：18-28 天（约 3-4 周）
- **人员**：1-2 名全栈开发

## 九、风险与对策

### R1: 平台限制导致无法自动读取 legacy scripts
- **对策**：设计"自动 + 半自动 + 引导补充"的 Audit；让报告可用而不是依赖单一 API（已实现）

### R2: 像素沙箱限制导致部分脚本不可复刻
- **对策**：清晰分级：可迁移 / 需改造 / 不建议（并提供替代方案）

### R3: 审核失败或反复
- **对策**：从一开始按 App Store requirements、session token、GraphQL-only 设计（已符合）

### R4: 事件对账与第三方平台接收不一致
- **对策**：只承诺"我们生成与发送正确"，提供可下载 payload、可复现证据

## 十、下一步行动

1. **立即开始**：Phase 1（安装后自动体检）
2. **并行进行**：Phase 2（套餐定义对齐）
3. **完成后**：Phase 3（手动脚本粘贴分析增强）
4. **MVP 完成后**：Phase 4-6（P1 功能）

## 十一、参考资料

- [设计方案文档](./DESIGN_V1.md)（用户提供的设计方案）
- [现有代码库](../README.md)
- [Shopify App Store Requirements](https://shopify.dev/docs/apps/store/requirements)
- [Built for Shopify](https://shopify.dev/docs/apps/tools/built-for-shopify)

