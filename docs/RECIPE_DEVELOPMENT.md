# Recipe 开发指南

本文档介绍如何为 Tracking Guardian 开发新的迁移配方（Migration Recipe）。

## 目录

1. [概述](#概述)
2. [Recipe 结构](#recipe-结构)
3. [检测模式编写](#检测模式编写)
4. [迁移步骤定义](#迁移步骤定义)
5. [验证测试编写](#验证测试编写)
6. [配置字段设计](#配置字段设计)
7. [提交 Recipe](#提交-recipe)
8. [最佳实践](#最佳实践)

---

## 概述

### 什么是 Recipe？

Recipe（配方）是 Tracking Guardian 的核心概念，用于定义如何将旧追踪代码迁移到新平台。每个 Recipe 包含：

- **识别规则** - 如何检测需要迁移的脚本
- **目标功能** - 迁移后的目标平台
- **配置表单** - 用户需要填写的配置项
- **迁移步骤** - 分步骤引导用户完成迁移
- **验证测试** - 确认迁移成功的测试用例

### Recipe 类型

| 类别 | 说明 | 示例 |
|------|------|------|
| analytics | 分析追踪 | GA4, Amplitude |
| advertising | 广告平台 | Meta, TikTok, Pinterest |
| survey | 问卷调查 | Fairing, KnoCommerce |
| custom | 自定义集成 | Webhook, API |

---

## Recipe 结构

### TypeScript 接口

```typescript
interface MigrationRecipe {
  // 基础信息
  id: string;                    // 唯一标识符 (kebab-case)
  version: string;               // 版本号 (semver)
  name: string;                  // 显示名称
  description: string;           // 描述
  category: RecipeCategory;      // 类别
  difficulty: "easy" | "medium" | "advanced";
  status: "stable" | "beta" | "deprecated";
  
  // 来源识别
  source: {
    type: RecipeSourceType;
    platform: string;
    detectionPatterns: RecipeDetectionPattern[];
  };
  
  // 目标平台
  target: {
    type: RecipeTargetType;
    fullSupport: boolean;
    limitations?: string[];
  };
  
  // 配置字段
  configFields: RecipeConfigField[];
  
  // 迁移步骤
  steps: RecipeMigrationStep[];
  
  // 验证测试
  validationTests: RecipeValidationTest[];
  
  // 元信息
  trackedEvents: string[];
  estimatedTimeMinutes: number;
  tags: string[];
  icon?: string;
  docsUrl?: string;
}
```

### 完整示例

```typescript
export const MY_PLATFORM_RECIPE: MigrationRecipe = {
  id: "my-platform",
  version: "1.0.0",
  name: "My Platform Integration",
  description: "将 My Platform 追踪迁移到服务端 API",
  category: "analytics",
  difficulty: "easy",
  status: "stable",
  
  source: {
    type: "script_tag",
    platform: "my-platform",
    detectionPatterns: [
      {
        patterns: [/myplatform\s*\(/i, /my-platform\.js/i],
        keywords: ["myplatform", "my-platform"],
        confidence: 0.9,
      },
    ],
  },
  
  target: {
    type: "server_capi",
    fullSupport: true,
  },
  
  configFields: [
    {
      key: "apiKey",
      label: "API Key",
      type: "text",
      description: "Your My Platform API key",
      required: true,
    },
  ],
  
  steps: [
    {
      order: 1,
      title: "启用 App Pixel",
      description: "点击启用按钮安装 Web Pixel",
      actionType: "auto",
      autoAction: "enable_web_pixel",
      estimatedMinutes: 1,
    },
    {
      order: 2,
      title: "配置 API Key",
      description: "输入您的 My Platform API Key",
      actionType: "config",
      estimatedMinutes: 2,
    },
    {
      order: 3,
      title: "验证追踪",
      description: "完成测试订单验证追踪",
      actionType: "manual",
      estimatedMinutes: 5,
    },
  ],
  
  validationTests: [
    {
      name: "event_received",
      description: "验证事件是否发送成功",
      type: "event_received",
      expectedEvent: "purchase",
      timeoutSeconds: 300,
    },
  ],
  
  trackedEvents: ["purchase"],
  estimatedTimeMinutes: 8,
  tags: ["my-platform", "analytics"],
  icon: "📊",
  docsUrl: "https://docs.myplatform.com/api",
};
```

---

## 检测模式编写

### RecipeDetectionPattern 结构

```typescript
interface RecipeDetectionPattern {
  patterns: RegExp[];           // 正则表达式数组
  keywords?: string[];          // 关键词数组
  confidence: number;           // 基础置信度 (0-1)
  excludePatterns?: RegExp[];   // 排除模式
}
```

### 置信度计算

匹配器计算置信度的公式：

```
score = (pattern_matches / total_patterns) * 0.7 
      + (keyword_matches / total_keywords) * 0.3

confidence = min(score * base_confidence, 1.0)
```

只有置信度 >= 0.3 的匹配才会返回。

### 编写技巧

#### 1. 使用多个模式提高准确性

```typescript
patterns: [
  /gtag\s*\(/i,           // 函数调用
  /G-[A-Z0-9]{10,}/i,     // Measurement ID
  /googletagmanager/i,    // 脚本 URL
]
```

#### 2. 使用关键词作为辅助信号

```typescript
keywords: ["gtag", "google-analytics", "ga4"]
```

#### 3. 使用排除模式避免误匹配

```typescript
excludePatterns: [
  /google-ads/i,          // 排除 Google Ads
  /AW-\d+/i,              // 排除 Conversion ID
]
```

#### 4. 合理设置基础置信度

- 高特异性模式：`confidence: 0.9`
- 中等特异性：`confidence: 0.7`
- 低特异性（通配）：`confidence: 0.5`

### 常见平台模式示例

#### Google Analytics 4

```typescript
patterns: [
  /gtag\s*\(/i,
  /G-[A-Z0-9]{10,}/i,
  /googletagmanager\.com\/gtag/i,
]
```

#### Meta Pixel

```typescript
patterns: [
  /fbq\s*\(/i,
  /connect\.facebook\.net/i,
  /pixel[_-]?id['":\s]+\d{15,16}/i,
]
```

#### TikTok Pixel

```typescript
patterns: [
  /ttq\s*[.(]/i,
  /analytics\.tiktok\.com/i,
]
```

---

## 迁移步骤定义

### RecipeMigrationStep 结构

```typescript
interface RecipeMigrationStep {
  order: number;              // 步骤顺序 (从 1 开始)
  title: string;              // 步骤标题
  description: string;        // 步骤描述
  actionType: "auto" | "manual" | "config";
  autoAction?: string;        // 自动操作标识
  estimatedMinutes: number;   // 预计耗时
  helpUrl?: string;           // 帮助链接
  warningMessage?: string;    // 警告信息
}
```

### 操作类型

#### auto - 自动操作

系统自动执行的操作：

```typescript
{
  actionType: "auto",
  autoAction: "enable_web_pixel",
}
```

支持的 autoAction：
- `enable_web_pixel` - 启用 Web Pixel
- `configure_platform` - 配置平台凭证

#### config - 配置操作

需要用户填写配置的步骤：

```typescript
{
  actionType: "config",
  title: "配置 API 凭证",
  description: "输入您的平台 API Key 和 Secret",
}
```

#### manual - 手动操作

需要用户在外部完成的操作：

```typescript
{
  actionType: "manual",
  title: "验证追踪",
  description: "在平台后台检查事件是否到达",
  helpUrl: "https://docs.example.com/verify",
}
```

### 步骤设计原则

1. **步骤数量**：4-6 步为宜
2. **先易后难**：将自动操作放在前面
3. **明确预期**：描述中说明预期结果
4. **提供帮助**：重要步骤提供 helpUrl

---

## 验证测试编写

### RecipeValidationTest 结构

```typescript
interface RecipeValidationTest {
  name: string;               // 测试名称
  description: string;        // 测试描述
  type: "event_received" | "parameter_check" | "timing_check" | "manual";
  expectedEvent?: string;     // 期望的事件类型
  requiredParams?: string[];  // 必需参数
  timeoutSeconds?: number;    // 超时时间
}
```

### 测试类型

#### event_received - 事件接收测试

验证是否收到指定事件：

```typescript
{
  name: "purchase_received",
  description: "验证 purchase 事件是否发送成功",
  type: "event_received",
  expectedEvent: "purchase",
  timeoutSeconds: 300,
}
```

#### parameter_check - 参数检查测试

验证事件包含必需参数：

```typescript
{
  name: "required_params",
  description: "验证事件包含必需参数",
  type: "parameter_check",
  requiredParams: ["currency", "value", "transaction_id"],
}
```

#### timing_check - 时序检查测试

验证事件时序（如去重）：

```typescript
{
  name: "no_duplicate",
  description: "验证事件未重复发送",
  type: "timing_check",
}
```

#### manual - 手动验证测试

需要用户手动确认的测试：

```typescript
{
  name: "visual_check",
  description: "请在平台后台确认事件已显示",
  type: "manual",
}
```

---

## 配置字段设计

### RecipeConfigField 结构

```typescript
interface RecipeConfigField {
  key: string;                // 字段键名
  label: string;              // 显示标签
  type: "text" | "password" | "select" | "checkbox" | "textarea";
  description: string;        // 字段描述
  required: boolean;          // 是否必填
  defaultValue?: string;      // 默认值
  validationPattern?: string; // 验证正则
  validationMessage?: string; // 验证失败消息
  options?: Array<{           // select 选项
    value: string;
    label: string;
  }>;
}
```

### 字段类型示例

#### text - 文本输入

```typescript
{
  key: "measurementId",
  label: "Measurement ID",
  type: "text",
  description: "GA4 Measurement ID (格式: G-XXXXXXXX)",
  required: true,
  validationPattern: "^G-[A-Z0-9]+$",
  validationMessage: "请输入有效的 GA4 Measurement ID",
}
```

#### password - 密码输入

```typescript
{
  key: "apiSecret",
  label: "API Secret",
  type: "password",
  description: "API Secret（不会明文显示）",
  required: true,
}
```

#### select - 下拉选择

```typescript
{
  key: "authType",
  label: "认证方式",
  type: "select",
  required: true,
  defaultValue: "bearer",
  options: [
    { value: "none", label: "无认证" },
    { value: "bearer", label: "Bearer Token" },
    { value: "basic", label: "Basic Auth" },
  ],
}
```

#### checkbox - 复选框

```typescript
{
  key: "enableDebug",
  label: "启用调试模式",
  type: "checkbox",
  description: "在控制台输出调试信息",
  required: false,
  defaultValue: "false",
}
```

### 验证模式示例

| 平台 | 验证模式 |
|------|----------|
| GA4 Measurement ID | `^G-[A-Z0-9]+$` |
| Meta Pixel ID | `^\\d{15,16}$` |
| HTTPS URL | `^https://` |
| Email | `^[^@]+@[^@]+\\.[^@]+$` |

---

## 提交 Recipe

### 开发流程

1. **创建 Recipe 文件**
   
   在 `app/services/recipes/` 目录下创建新文件：
   
   ```bash
   app/services/recipes/
   ├── registry.ts       # 所有 Recipe 注册
   ├── types.ts          # 类型定义
   ├── matcher.ts        # 匹配器
   └── executor.ts       # 执行器
   ```

2. **定义 Recipe**
   
   在 `registry.ts` 中添加新 Recipe：
   
   ```typescript
   export const NEW_PLATFORM_RECIPE: MigrationRecipe = {
     // ... Recipe 定义
   };
   ```

3. **注册 Recipe**
   
   将 Recipe 添加到 `RECIPE_REGISTRY` 数组：
   
   ```typescript
   export const RECIPE_REGISTRY: MigrationRecipe[] = [
     GA4_BASIC_RECIPE,
     META_CAPI_RECIPE,
     // ...
     NEW_PLATFORM_RECIPE, // 新增
   ];
   ```

4. **编写测试**
   
   在 `tests/services/recipes/` 下添加测试：
   
   ```typescript
   describe("NEW_PLATFORM_RECIPE", () => {
     it("should detect platform patterns", () => {
       // 测试检测模式
     });
     
     it("should validate config", () => {
       // 测试配置验证
     });
   });
   ```

5. **提交 PR**
   
   - 确保所有测试通过
   - 更新 CHANGELOG
   - 提交 Pull Request

### 审核清单

提交前请确认：

- [ ] Recipe ID 唯一且使用 kebab-case
- [ ] 版本号遵循 semver
- [ ] 所有必填字段已定义
- [ ] 检测模式经过测试
- [ ] 步骤顺序正确 (从 1 开始)
- [ ] estimatedTimeMinutes 等于所有步骤之和
- [ ] 验证测试覆盖主要场景
- [ ] 单元测试通过

---

## 最佳实践

### 1. 检测模式

- ✅ 使用多个特征组合提高准确性
- ✅ 测试真实脚本片段
- ✅ 考虑版本差异
- ❌ 避免过于宽泛的模式
- ❌ 避免只匹配单个字符

### 2. 配置字段

- ✅ 提供清晰的描述和帮助文本
- ✅ 使用验证模式确保输入正确
- ✅ 为可选字段提供默认值
- ❌ 避免要求不必要的信息

### 3. 迁移步骤

- ✅ 将复杂操作拆分成小步骤
- ✅ 自动操作优先
- ✅ 提供回滚说明
- ❌ 避免跳跃式步骤

### 4. 验证测试

- ✅ 覆盖核心功能
- ✅ 设置合理的超时时间
- ✅ 提供失败时的修复建议
- ❌ 避免只依赖手动测试

### 5. 文档

- ✅ 提供 docsUrl 链接
- ✅ 使用清晰的描述
- ✅ 包含常见问题解答
- ❌ 避免使用技术术语

---

## 资源

- [Recipe 类型定义](../app/services/recipes/types.ts)
- [现有 Recipe 参考](../app/services/recipes/registry.ts)
- [匹配器实现](../app/services/recipes/matcher.ts)
- [执行器实现](../app/services/recipes/executor.ts)

---

*最后更新: 2025 年 12 月*

