# 扫描页面订阅计划卡片代码深度分析报告

## 分析范围
- 文件：`app/routes/app.scan.tsx`
- 对比参考：`app/routes/app.migrate.tsx`
- 相关工具：`app/utils/plans.ts`

## 发现的问题

### 🔴 问题 1：Loader 中缺少套餐信息

**位置**：`app/routes/app.scan.tsx` 第 100-110 行

**问题描述**：
```typescript
const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
        id: true,
        shopDomain: true,
        shopTier: true,
        typOspPagesEnabled: true,
        typOspUpdatedAt: true,
        typOspLastCheckedAt: true,
        typOspStatusReason: true,
        // ❌ 缺少 plan 字段
    },
});
```

**对比 `app.migrate.tsx`**（第 27-40 行）：
```typescript
const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
        id: true,
        shopDomain: true,
        ingestionSecret: true,
        webPixelId: true,
        plan: true,  // ✅ 包含 plan 字段
        typOspPagesEnabled: true,
        // ...
    },
});
```

**影响**：
- 无法获取店铺的套餐信息
- 无法在页面中显示当前套餐
- 无法根据套餐显示不同的功能限制提示

---

### 🔴 问题 2：Loader 返回值中缺少套餐相关字段

**位置**：`app/routes/app.scan.tsx` 第 253-275 行

**问题描述**：
```typescript
return json({
    shop: { id: shop.id, domain: shopDomain },
    latestScan,
    scanHistory,
    migrationActions,
    deprecationStatus: { /* ... */ },
    upgradeStatus: { /* ... */ },
    // ❌ 缺少 planId, planLabel, planTagline
});
```

**对比 `app.migrate.tsx`**（第 133-156 行）：
```typescript
return json({
    shop: { id: shop.id, domain: shopDomain },
    // ...
    planId,                    // ✅ 包含套餐 ID
    planLabel: planDef.name,   // ✅ 包含套餐名称
    planTagline: planDef.tagline, // ✅ 包含套餐标语
    // ...
});
```

**影响**：
- 组件无法访问套餐信息
- 无法根据套餐显示不同的 UI

---

### 🔴 问题 3：缺少套餐相关的工具函数导入

**位置**：`app/routes/app.scan.tsx` 文件顶部

**问题描述**：
- 没有导入 `normalizePlan`、`getPlanDefinition`、`isPlanAtLeast` 等函数
- 没有导入 `PLAN_DEFINITIONS` 常量

**对比 `app.migrate.tsx`**（第 18 行）：
```typescript
import { getPlanDefinition, normalizePlan, isPlanAtLeast } from "../utils/plans";
```

**影响**：
- 即使添加了套餐数据，也无法进行套餐相关的逻辑处理

---

### 🔴 问题 4：页面中缺少订阅计划卡片组件

**位置**：`app/routes/app.scan.tsx` 组件渲染部分

**问题描述**：
- 根据图片描述，应该有一个显示"当前套餐: 免费版"的卡片
- 包含功能列表和升级提示
- 但当前代码中完全没有这个组件

**对比 `app.migrate.tsx`**（第 556-594 行）：
```typescript
<Banner
  title={`当前套餐：${planLabel || planId}`}
  tone={isGrowthOrAbove ? "success" : "warning"}
  action={{
    content: "查看套餐/升级",
    url: "/app/settings?tab=billing",
  }}
>
  <BlockStack gap="200">
    {planTagline && (
      <Text as="p" variant="bodySm">{planTagline}</Text>
    )}
    {!isGrowthOrAbove && (
      <List type="bullet">
        <List.Item>像素迁移中心（App Pixel + CAPI 向导）在 Growth 及以上开放</List.Item>
        <List.Item>高级 TY/OS 组件、事件对账与多渠道像素需 Pro 及以上</List.Item>
        <List.Item>多店铺/白标报告在 Agency 套餐提供</List.Item>
      </List>
    )}
    {/* ... 其他套餐级别的提示 ... */}
  </BlockStack>
</Banner>
```

**影响**：
- 用户无法看到当前套餐信息
- 无法了解功能限制和升级选项
- 用户体验不一致（其他页面有，扫描页面没有）

---

### 🟡 问题 5：代码一致性问题

**问题描述**：
- `app.scan.tsx` 和 `app.migrate.tsx` 在套餐信息处理上不一致
- 两个页面应该显示相同的套餐信息，但实现方式不同

**影响**：
- 维护成本高
- 容易出现不一致的显示
- 代码重复

---

## 修复建议

### 1. 修复 Loader 中的套餐信息获取

**修改位置**：`app/routes/app.scan.tsx` 第 100-110 行

```typescript
const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
        id: true,
        shopDomain: true,
        shopTier: true,
        plan: true,  // ✅ 添加 plan 字段
        typOspPagesEnabled: true,
        typOspUpdatedAt: true,
        typOspLastCheckedAt: true,
        typOspStatusReason: true,
    },
});
```

### 2. 添加套餐工具函数导入

**修改位置**：`app/routes/app.scan.tsx` 文件顶部

```typescript
import { getPlanDefinition, normalizePlan, isPlanAtLeast } from "../utils/plans";
```

### 3. 在 Loader 中处理套餐信息

**修改位置**：`app/routes/app.scan.tsx` 第 252 行之后

```typescript
const shopUpgradeStatus: ShopUpgradeStatus = {
    tier: shopTier,
    typOspPagesEnabled,
    typOspUpdatedAt,
    typOspUnknownReason,
    typOspUnknownError,
};
const upgradeStatusMessage = getUpgradeStatusMessage(shopUpgradeStatus, hasScriptTags);

// ✅ 添加套餐信息处理
const planId = normalizePlan(shop.plan);
const planDef = getPlanDefinition(planId);

return json({
    shop: { id: shop.id, domain: shopDomain },
    latestScan,
    scanHistory,
    migrationActions,
    deprecationStatus: {
        shopTier,
        scriptTag: {
            ...formatDeadlineForUI(scriptTagStatus),
            isExpired: scriptTagStatus.isExpired,
        },
        additionalScripts: {
            ...formatDeadlineForUI(additionalScriptsStatus),
            isExpired: additionalScriptsStatus.isExpired,
        },
        migrationUrgency,
    },
    upgradeStatus: {
        ...upgradeStatusMessage,
        lastUpdated: typOspUpdatedAt?.toISOString() || null,
        hasOfficialSignal: typOspUpdatedAt !== null,
    },
    // ✅ 添加套餐信息
    planId,
    planLabel: planDef.name,
    planTagline: planDef.tagline,
});
```

### 4. 在组件中添加订阅计划卡片

**修改位置**：`app/routes/app.scan.tsx` 第 536 行（组件开始处）

```typescript
export default function ScanPage() {
    const { 
        shop, 
        latestScan, 
        scanHistory, 
        deprecationStatus, 
        upgradeStatus, 
        migrationActions,
        planId,        // ✅ 添加套餐信息
        planLabel,
        planTagline,
    } = useLoaderData<typeof loader>();
    
    // ✅ 添加套餐级别判断
    const isGrowthOrAbove = isPlanAtLeast(planId, "growth");
    const isProOrAbove = isPlanAtLeast(planId, "pro");
    const isAgency = isPlanAtLeast(planId, "agency");
    
    // ... 其他代码 ...
```

**修改位置**：`app/routes/app.scan.tsx` 第 1292 行之后（在 upgradeStatus Banner 之后）

```typescript
      })()}

      {/* ✅ 添加订阅计划卡片 */}
      {planId && planLabel && (
        <Banner
          title={`当前套餐：${planLabel}`}
          tone={isGrowthOrAbove ? "success" : "warning"}
          action={{
            content: "查看套餐/升级",
            url: "/app/settings?tab=billing",
          }}
        >
          <BlockStack gap="200">
            {planTagline && (
              <Text as="p" variant="bodySm">{planTagline}</Text>
            )}
            {!isGrowthOrAbove && (
              <List type="bullet">
                <List.Item>像素迁移中心（App Pixel + CAPI 向导）在 Growth 及以上开放</List.Item>
                <List.Item>高级 TY/OS 组件、事件对账与多渠道像素需 Pro 及以上</List.Item>
                <List.Item>多店铺/白标报告在 Agency 套餐提供</List.Item>
              </List>
            )}
            {isGrowthOrAbove && !isProOrAbove && (
              <List type="bullet">
                <List.Item>当前可用：App Pixel + 单/双渠道 CAPI 迁移</List.Item>
                <List.Item>升级到 Pro 以解锁事件对账、告警与高级 TY/OS 模块</List.Item>
              </List>
            )}
            {isProOrAbove && !isAgency && (
              <List type="bullet">
                <List.Item>已解锁多渠道像素 + 事件对账 + TY/OS 高级组件</List.Item>
                <List.Item>如需多店铺协作/白标报告，可升级至 Agency</List.Item>
              </List>
            )}
            {isAgency && (
              <List type="bullet">
                <List.Item>已解锁多店铺、协作与白标报告</List.Item>
                <List.Item>如需迁移托管，可在支持渠道提交工单</List.Item>
              </List>
            )}
          </BlockStack>
        </Banner>
      )}

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
```

---

## 类型安全问题

### 问题 6：Loader 返回类型定义不完整

**问题描述**：
- Loader 返回的 JSON 类型没有明确定义
- 缺少套餐相关字段的类型定义

**建议**：
- 创建明确的 LoaderData 类型接口
- 确保类型安全

---

## 总结

### 严重程度分类

1. **🔴 严重问题**（必须修复）：
   - Loader 中缺少 `plan` 字段
   - Loader 返回值中缺少套餐信息
   - 页面中缺少订阅计划卡片组件

2. **🟡 中等问题**（建议修复）：
   - 缺少套餐工具函数导入
   - 代码一致性问题
   - 类型定义不完整

### 修复优先级

1. **高优先级**：修复 Loader 中的套餐信息获取和返回
2. **中优先级**：添加订阅计划卡片组件
3. **低优先级**：统一代码风格，完善类型定义

### 测试建议

修复后需要测试：
1. 免费版用户能看到正确的套餐信息
2. 不同套餐级别显示不同的功能提示
3. "查看套餐/升级"按钮能正确跳转
4. 套餐信息与数据库一致

