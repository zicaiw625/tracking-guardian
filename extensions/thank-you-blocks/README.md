# Thank You Blocks UI Extensions

## 概述

此扩展包包含多个 UI Extension 模块，用于在 Shopify Checkout 的 Thank You 页面和 Customer Account 的 Order Status 页面提供增强功能。

## 扩展点说明

### 1. Purchase Thank You Page (`purchase.thank-you.block.render`)

**能力边界：**
- ✅ 可以访问订单信息（通过 Shopify 提供的 context）
- ✅ 可以调用后端 API（需要 `network_access = true`）
- ✅ 可以显示自定义 UI 组件（Survey、Shipping Tracker、Support、Reorder 等）
- ⚠️ 不能访问客户 PII 数据（除非通过 Protected Customer Data API，需要额外权限申请）

**网络访问：**
- 所有需要调用后端 API 的模块都已配置 `network_access = true`
- 后端 API 端点：
  - `/api/survey` - 提交调查问卷
  - `/api/tracking` - 获取物流信息
  - `/api/reorder` - 重新下单
  - `/api/support` - 支持相关功能

### 2. Customer Account Order Status (`customer-account.order-status.block.render`)

**能力边界：**
- ✅ 可以访问订单信息（通过 Shopify 提供的 context）
- ✅ 可以显示自定义 UI 组件
- ⚠️ 某些功能可能需要 Protected Customer Data (PCD) 访问权限
- ⚠️ 需要在 Partner Dashboard 中申请相应的权限范围

**网络访问：**
- 部分模块需要 `network_access = true`（如 Survey、Shipping Tracker）
- 部分模块不需要网络访问（如 Support、Reorder - 使用本地构建的链接）

## 模块列表

### Survey Block
- **Thank You**: ✅ 支持（需要 network_access）
- **Order Status**: ✅ 支持（需要 network_access）
- **功能**: 收集客户反馈

### Shipping Tracker
- **Thank You**: ✅ 支持（需要 network_access）
- **Order Status**: ✅ 支持（需要 network_access）
- **功能**: 显示订单状态和物流信息

### Support & FAQ
- **Thank You**: ✅ 支持（不需要 network_access）
- **Order Status**: ✅ 支持（不需要 network_access）
- **功能**: 显示支持联系方式和 FAQ 链接

### Reorder Button
- **Thank You**: ✅ 支持（需要 network_access，调用后端获取订单 line items）
- **Order Status**: ✅ 支持（不需要 network_access，使用本地构建的 cart permalink）
- **功能**: 快速重新下单

## 配置说明

### Network Access

所有需要调用后端 API 的扩展都已配置 `network_access = true`：

```toml
[extensions.capabilities]
network_access = true
```

**重要提示：**
- 必须在 Partner Dashboard 中启用 Network Access 权限
- 否则扩展将无法调用后端 API，导致功能失效

### Settings Schema

每个模块都有对应的 settings 字段，可以在 Shopify Admin 中配置：
- Survey: `survey_title`, `survey_question`
- Shipping Tracker: `shipping_title`, `shipping_tip_text`
- Support: `support_title`, `support_description`, `support_contact_url`, etc.
- Reorder: `reorder_title`, `reorder_subtitle`, `reorder_button_text`

## 部署注意事项

1. **Network Access 权限**：确保在 Partner Dashboard 中已启用
2. **API 端点**：确保后端 API 端点可访问且支持 CORS
3. **环境变量**：确保后端 URL 配置正确
4. **测试**：在 Test 和 Live 环境中分别测试所有模块

## 故障排查

### 问题：扩展无法调用后端 API

**可能原因：**
1. Network Access 未在 Partner Dashboard 中启用
2. 后端 API 端点不可访问
3. CORS 配置问题

**解决方案：**
1. 检查 Partner Dashboard 中的 Network Access 设置
2. 检查后端 API 日志
3. 检查浏览器控制台的 CORS 错误

### 问题：Order Status 页面功能受限

**可能原因：**
1. 需要 Protected Customer Data (PCD) 权限
2. 权限范围不足

**解决方案：**
1. 在 Partner Dashboard 中申请相应的 PCD 权限
2. 检查权限范围是否包含所需的数据访问

## 参考文档

- [Shopify UI Extensions Documentation](https://shopify.dev/docs/api/checkout-ui-extensions)
- [Customer Account Extensions](https://shopify.dev/docs/api/customer-account-ui-extensions)
- [Network Access Configuration](https://shopify.dev/docs/apps/build/app-extensions/configuration#network-access)

