# Modules 模块化架构

P2-1: 模块化目录重构，提升代码可维护性和迭代速度。

## 目录结构

```
app/modules/
├── shopify/        # Shopify API 集成
├── alerts/         # 通知渠道 (email/slack/telegram)
├── scan/           # 脚本扫描和分析
├── conversions/    # 转化 job 处理和平台适配
├── ingest/         # Pixel 事件接收和验证
├── upgrade/        # Checkout 升级指导
├── reconciliation/ # 对账和健康检查
└── index.ts        # 统一入口

app/infrastructure/
├── db/            # 数据库访问层
├── crypto/        # 加密工具
├── cache/         # 缓存和限流
└── index.ts       # 统一入口
```

## 使用方式

### 方式 1: 从统一入口导入

```typescript
// 从 modules 入口导入业务模块
import { 
  scanShopTracking,
  sendAlert,
  processConversionJobs,
} from "~/modules";

// 从 infrastructure 入口导入基础设施
import {
  prisma,
  getRedisClient,
  encrypt,
} from "~/infrastructure";
```

### 方式 2: 从特定模块导入

```typescript
// 只导入需要的模块
import { 
  scanShopTracking, 
  getScanHistory 
} from "~/modules/scan";

import { 
  sendAlert, 
  testNotification 
} from "~/modules/alerts";

import { 
  verifyReceiptTrust,
  buildTrustMetadata 
} from "~/modules/reconciliation";
```

## 模块说明

### shopify - Shopify 集成

```typescript
import {
  // Admin API 客户端
  createAdminClientForShop,
  executeGraphQL,
  
  // 认证和配置
  authenticate,
  apiVersion,
  
  // Shop 访问
  checkShopAccess,
  verifyShopifyJWT,
} from "~/modules/shopify";
```

### alerts - 通知系统

```typescript
import {
  // 发送通知
  sendAlert,
  testNotification,
  
  // 设置管理
  encryptAlertSettings,
  decryptAlertSettings,
  getMaskedAlertSettings,
} from "~/modules/alerts";
```

### scan - 脚本扫描

```typescript
import {
  // 扫描功能
  scanShopTracking,
  getCachedScanResult,
  getScanHistory,
  
  // 内容分析
  analyzeScriptContent,
  detectPlatforms,
  
  // 风险评估
  assessRisks,
  calculateRiskScore,
} from "~/modules/scan";
```

### conversions - 转化处理

```typescript
import {
  // Job 处理
  processConversionJobs,
  getBatchBackoffDelay,
  
  // 平台发送
  sendConversionToPlatform,
  
  // 重试管理
  processRetries,
  classifyFailureReason,
} from "~/modules/conversions";
```

### ingest - 事件接收

```typescript
import {
  // Receipt 匹配
  batchFetchReceipts,
  findReceiptForJob,
  
  // 信任评估
  evaluateTrust,
  checkPlatformEligibility,
  
  // Consent 处理
  shouldSendToPlatform,
  getConsentRequirements,
} from "~/modules/ingest";
```

### upgrade - 升级指导

```typescript
import {
  // 时间线
  DEPRECATION_DATES,
  getScriptTagDeprecationStatus,
  getMigrationUrgencyStatus,
  
  // Checkout Profile
  getTypOspActive,
  refreshTypOspStatus,
  
  // 迁移
  createWebPixel,
  updateWebPixel,
} from "~/modules/upgrade";
```

### reconciliation - 对账

```typescript
import {
  // Receipt 验证
  verifyReceiptTrust,
  isSendAllowedByTrust,
  
  // 健康检查
  runAllShopsDeliveryHealthCheck,
  
  // Consent 对账
  reconcilePendingConsent,
} from "~/modules/reconciliation";
```

## 基础设施层

### infrastructure/db - 数据库

```typescript
import {
  // Prisma 客户端
  prisma,
  
  // Shop 仓库
  getShopById,
  getShopWithPixels,
  
  // Pixel 配置
  getShopPixelConfigs,
  upsertPixelConfig,
  
  // 审计日志
  createAuditLog,
  getAuditLogsForShop,
} from "~/infrastructure/db";
```

### infrastructure/crypto - 加密

```typescript
import {
  // 通用加密
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  
  // Token 加密
  encryptAccessToken,
  decryptAccessToken,
  
  // 哈希和归一化
  hashValue,
  normalizeEmail,
  normalizePhone,
} from "~/infrastructure/crypto";
```

### infrastructure/cache - 缓存

```typescript
import {
  // Redis
  getRedisClient,
  getRedisConnectionInfo,
  
  // 内存缓存
  SimpleCache,
  memoize,
  memoizeAsync,
  
  // 限流
  withRateLimit,
  standardRateLimit,
  
  // Circuit Breaker
  CircuitBreaker,
} from "~/infrastructure/cache";
```

## 迁移指南

现有代码可以逐步迁移到新模块系统:

```typescript
// 旧方式
import { scanShopTracking } from "~/services/scanner.server";
import { sendAlert } from "~/services/notification.server";

// 新方式
import { scanShopTracking } from "~/modules/scan";
import { sendAlert } from "~/modules/alerts";
```

所有旧的导入路径仍然有效，模块层只是提供了更清晰的组织结构。

## 注意事项

1. **渐进式迁移**: 不需要一次性迁移所有代码，新旧导入方式可以共存
2. **类型安全**: 所有模块都正确导出 TypeScript 类型
3. **向后兼容**: 原有的 services/ 和 utils/ 目录保持不变
4. **单一职责**: 每个模块负责一个明确的业务领域

