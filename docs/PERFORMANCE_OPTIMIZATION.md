# 前端性能优化方案

## 目标
达到 Shopify Built for Shopify (BFS) 标准：
- **LCP (Largest Contentful Paint)**: < 2.5s
- **CLS (Cumulative Layout Shift)**: < 0.1
- **INP (Interaction to Next Paint)**: < 200ms

## 优化策略

### 1. 资源加载优化

#### 1.1 预连接和 DNS 预解析
- ✅ 已实现: Shopify CDN 预连接 (`preconnect`)
- ⚠️ 待优化: 添加更多关键资源的预连接

#### 1.2 代码分割和懒加载
- ⚠️ 待实现: 重型组件动态导入
  - `ScriptCodeEditor` - 代码编辑器组件
  - `RealtimeEventMonitor` - 实时监控组件
  - `BatchApplyWizard` - 批量应用向导
  - `PixelMigrationWizard` - 像素迁移向导

#### 1.3 路由级代码分割
- ✅ 已启用: `v3_lazyRouteDiscovery` in Vite config
- ⚠️ 待优化: 确保所有路由都使用懒加载

### 2. 渲染优化

#### 2.1 流式渲染
- ✅ 已实现: Remix `renderToPipeableStream` with `onShellReady`

#### 2.2 组件级优化
- ⚠️ 待实现: React.memo 包装重型组件
- ⚠️ 待实现: useMemo/useCallback 优化计算密集型操作

#### 2.3 骨架屏
- ✅ 已实现: `CardSkeleton`, `TableSkeleton`
- ⚠️ 待优化: 确保所有数据加载都有骨架屏

### 3. 网络优化

#### 3.1 数据获取优化
- ⚠️ 待实现: 使用 Remix `defer` 进行增量数据加载
- ⚠️ 待实现: 实现数据预取（prefetch）

#### 3.2 缓存策略
- ⚠️ 待实现: 静态资源缓存头
- ⚠️ 待实现: API 响应缓存（如适用）

### 4. 图片和媒体优化

#### 4.1 图片懒加载
- ⚠️ 待实现: 使用 `loading="lazy"` 属性

#### 4.2 响应式图片
- ⚠️ 待实现: 使用 `srcset` 和 `sizes` 属性

### 5. CSS 优化

#### 5.1 关键 CSS 内联
- ⚠️ 待实现: 提取关键 CSS 并内联

#### 5.2 CSS 压缩
- ✅ 已实现: Vite 自动压缩 CSS

### 6. JavaScript 优化

#### 6.1 Tree Shaking
- ✅ 已实现: Vite 自动 tree shaking

#### 6.2 代码压缩
- ✅ 已实现: Vite 自动压缩

#### 6.3 减少包大小
- ⚠️ 待检查: 分析 bundle 大小，移除未使用的依赖

### 7. 运行时性能

#### 7.1 减少重渲染
- ⚠️ 待实现: 使用 React DevTools Profiler 识别性能瓶颈

#### 7.2 虚拟滚动
- ⚠️ 待评估: 大数据列表使用虚拟滚动

#### 7.3 Web Workers
- ⚠️ 待评估: 将重型计算移至 Web Worker

### 8. 监控和测量

#### 8.1 Web Vitals 监控
- ⚠️ 待实现: 集成 Web Vitals 库

#### 8.2 性能预算
- ⚠️ 待定义: 设置性能预算并监控

## 实施计划

### Phase 1: 快速优化（高影响，低风险）
1. ✅ 添加资源预连接
2. ⚠️ 重型组件动态导入
3. ⚠️ 优化 Polaris 组件导入（按需导入）

### Phase 2: 渲染优化
1. ⚠️ React.memo 包装组件
2. ⚠️ useMemo/useCallback 优化
3. ⚠️ 骨架屏完善

### Phase 3: 网络优化
1. ⚠️ 使用 defer 进行增量加载
2. ⚠️ 实现数据预取
3. ⚠️ 缓存策略优化

### Phase 4: 监控和测量
1. ⚠️ 集成 Web Vitals
2. ⚠️ 性能预算设置

## 测量方法

### 开发环境
- Chrome DevTools Performance 面板
- Lighthouse
- React DevTools Profiler

### 生产环境
- Web Vitals API
- Real User Monitoring (RUM)
- Shopify Analytics

## 成功指标

- LCP < 2.5s (目标: < 2.0s)
- CLS < 0.1 (目标: < 0.05)
- INP < 200ms (目标: < 150ms)
- FCP < 1.8s
- TTI < 3.8s

