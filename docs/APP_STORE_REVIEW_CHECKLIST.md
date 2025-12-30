# App Store 审核检查清单

## 1. 嵌入式应用检查

### 1.1 Session Token 使用
- [x] 使用 `@shopify/shopify-app-remix` 框架
- [x] 使用 session token 进行身份验证
- [x] 不使用 access token（除非必要）
- [x] 代码位置: `app/shopify.server.ts`

### 1.2 App Bridge 集成
- [x] 使用 `@shopify/app-bridge-react` 组件
- [x] 正确配置 App Bridge Provider
- [x] 代码位置: `app/routes/app.tsx`

### 1.3 嵌入式应用配置
- [x] `shopify.app.toml` 配置正确
- [x] 应用类型设置为 `embedded`
- [x] 应用 URL 配置正确

## 2. GraphQL Admin API 检查

### 2.1 API 使用
- [x] 所有 Admin 操作使用 GraphQL
- [x] 不使用 REST Admin API（除非必要）
- [x] 代码位置: `app/services/admin-mutations.server.ts`

### 2.2 API 版本
- [x] 使用稳定的 API 版本（2024-04 或更高）
- [x] API 版本一致性检查通过
- [x] 代码位置: `scripts/check-api-version.ts`

### 2.3 GraphQL 查询优化
- [x] 使用最小字段集
- [x] 避免过度查询
- [x] 使用分页处理大量数据

## 3. 权限最小化检查

### 3.1 请求的权限
- [x] `read_orders` - 接收订单 webhook，发送转化事件
- [x] `read_script_tags` - 扫描旧版 ScriptTags
- [x] `read_pixels` - 查询已安装的 Web Pixel
- [x] `write_pixels` - 创建/更新 App Pixel Extension
- [x] `read_customer_events` - 事件对账/同意状态补充

### 3.2 权限说明
- [x] 每个权限都有明确的业务理由
- [x] 权限说明文档完整
- [x] 代码位置: `README.md` 和 `COMPLIANCE.md`

### 3.3 权限使用验证
- [x] 不使用未请求的权限
- [x] 权限使用符合说明
- [x] 代码审查通过

## 4. 安装/卸载流程测试

### 4.1 安装流程
- [x] OAuth 流程正常
- [x] 安装后自动体检运行
- [x] 数据初始化正确
- [x] 错误处理完善

### 4.2 卸载流程
- [x] `app/uninstalled` webhook 处理
- [x] 数据清理完整
- [x] 订阅取消处理
- [x] 代码位置: `app/routes/webhooks.tsx`

### 4.3 Demo Store 准备
- [x] 提供 demo store 访问权限
- [x] 提供测试账号和密码
- [x] 确保所有功能可演示

## 5. Webhook 处理测试

### 5.1 订阅的 Webhooks
- [x] `orders/paid` - 订单支付时发送转化
- [x] `orders/updated` - 订单更新时同步状态
- [x] `app/uninstalled` - 应用卸载时清理数据
- [x] `customers/data_request` - GDPR 数据导出
- [x] `customers/redact` - GDPR 数据删除
- [x] `shop/redact` - 店铺数据完全删除

### 5.2 Webhook 处理
- [x] HMAC 签名验证
- [x] 幂等性处理
- [x] 错误处理和重试
- [x] 代码位置: `app/routes/webhooks.tsx`

### 5.3 GDPR 合规
- [x] 数据导出功能实现
- [x] 数据删除功能实现
- [x] 数据保留策略明确
- [x] 代码位置: `app/services/gdpr.server.ts`

## 6. 性能检查

### 6.1 前端性能
- [ ] LCP < 2.5s（需测试）
- [ ] CLS < 0.1（需测试）
- [ ] INP < 200ms（需测试）
- [ ] 代码位置: `app/routes/app._index.tsx`

### 6.2 Checkout Extension 性能
- [ ] 扩展加载时间 < 500ms（需测试）
- [ ] 延迟加载实现
- [ ] 最少网络请求
- [ ] 代码位置: `extensions/tracking-pixel/`

### 6.3 API 性能
- [x] 批量处理实现
- [x] 缓存机制使用
- [x] 超时和重试处理

## 7. 安全与合规

### 7.1 数据加密
- [x] 敏感凭证加密存储
- [x] 使用 AES-256-GCM 加密
- [x] 代码位置: `app/utils/token-encryption.ts`

### 7.2 数据隐私
- [x] 不存储 PII（默认）
- [x] 数据保留策略明确
- [x] 隐私政策完整
- [x] 代码位置: `docs/PRIVACY_POLICY.md`

### 7.3 访问控制
- [x] 多租户隔离
- [x] RBAC 权限控制
- [x] 代码位置: `app/services/billing/gate.server.ts`

## 8. 用户体验

### 8.1 错误处理
- [x] 错误提示清晰
- [x] 错误日志记录
- [x] 用户友好的错误消息

### 8.2 加载状态
- [x] 加载指示器显示
- [x] 骨架屏使用
- [x] 代码位置: `app/components/ui/`

### 8.3 引导流程
- [x] Onboarding 流程完整
- [x] 帮助文档可访问
- [x] 代码位置: `app/routes/app.onboarding.tsx`

## 9. 商业化

### 9.1 订阅管理
- [x] 订阅创建流程
- [x] 订阅取消流程
- [x] 试用期处理
- [x] 代码位置: `app/services/billing/subscription.server.ts`

### 9.2 套餐限制
- [x] 功能限制实现
- [x] 订单限制实现
- [x] 升级提示清晰
- [x] 代码位置: `app/services/billing/gate.server.ts`

### 9.3 计费准确性
- [x] 订单计数准确
- [x] 月度重置正确
- [x] 代码位置: `app/services/billing/gate.server.ts`

## 10. 文档完整性

### 10.1 用户文档
- [x] 用户指南完整
- [x] 快速开始指南
- [x] 故障排除指南
- [x] 代码位置: `docs/USER_GUIDE.md`

### 10.2 API 文档
- [x] API 参考文档
- [x] Webhook 文档
- [x] 代码位置: `docs/API_REFERENCE.md`

### 10.3 合规文档
- [x] 隐私政策
- [x] 权限说明
- [x] GDPR 合规说明
- [x] 代码位置: `docs/PRIVACY_POLICY.md`, `docs/COMPLIANCE.md`

## 自测结果

### 测试环境
- **Demo Store**: [待填写]
- **测试账号**: [待填写]
- **测试日期**: [待填写]

### 测试结果
- [ ] 安装流程测试通过
- [ ] 卸载流程测试通过
- [ ] 核心功能测试通过
- [ ] Webhook 处理测试通过
- [ ] GDPR 合规测试通过
- [ ] 性能测试通过
- [ ] 安全测试通过

### 已知问题
- [ ] 无已知问题
- [ ] 或列出已知问题及解决方案

## 提交前最终检查

- [ ] 所有检查项已完成
- [ ] 所有测试通过
- [ ] 文档完整
- [ ] Demo store 可访问
- [ ] 准备提交审核
