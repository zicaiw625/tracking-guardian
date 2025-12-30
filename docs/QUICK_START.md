# 5 分钟快速开始指南

## 第一步：安装应用（1 分钟）

1. 从 Shopify App Store 安装 Tracking Guardian
2. 授权应用访问所需权限
3. 安装完成后自动跳转到仪表盘

## 第二步：查看风险扫描（1 分钟）

安装后应用会自动运行一次基础体检：

- ✅ 检查升级状态（是否已升级到新 Checkout）
- ✅ 扫描 ScriptTags（识别旧追踪脚本）
- ✅ 计算风险分数（High/Medium/Low）
- ✅ 生成迁移清单

在仪表盘查看扫描结果，了解需要迁移的内容。

## 第三步：运行完整扫描（2 分钟）

1. 点击「开始 Audit」按钮
2. 等待自动扫描完成（约 30 秒）
3. 如有 Additional Scripts，手动粘贴进行分析
4. 查看详细的迁移建议和优先级

## 第四步：迁移像素（5 分钟）

### 方式一：使用向导（推荐）

1. 进入「迁移」页面
2. 点击「使用向导配置」
3. 选择平台（GA4/Meta/TikTok）
4. 填写 API 凭证
5. 配置事件映射（使用推荐映射）
6. 保存并验证

### 方式二：手动配置

1. 进入「设置」→「服务端追踪」
2. 选择平台并填写凭证
3. 配置事件映射
4. 保存配置

## 第五步：验证追踪（2 分钟）

1. 创建一个测试订单
2. 在「验收」页面查看事件是否触发
3. 检查事件参数完整性
4. 验证金额准确性

## 常见问题

### Q: 如何获取 API 凭证？

**GA4**:
- Measurement ID: GA4 管理后台 → 数据流 → Measurement ID
- API Secret: GA4 管理后台 → 数据流 → Measurement Protocol API secrets

**Meta**:
- Pixel ID: Meta Events Manager → Settings
- Access Token: Meta Events Manager → Settings → Conversions API → Generate Token

**TikTok**:
- Pixel ID: TikTok Events Manager → Web Events
- Access Token: TikTok Events Manager → Settings → Web Events → Generate Token

### Q: 测试环境和生产环境有什么区别？

- **测试环境**: 事件发送到平台的测试端点，不会影响实际广告数据
- **生产环境**: 事件发送到实际广告平台，影响广告归因和优化

建议先在测试环境验证，确认无误后再切换到生产环境。

### Q: 如何查看事件是否成功发送？

1. **GA4**: 在 GA4 DebugView 中查看
2. **Meta**: 在 Meta Events Manager 的「测试事件」页面查看（需要 Test Event Code）
3. **监控页面**: 在应用的「监控」页面查看事件成功率

### Q: 迁移后需要删除旧的 ScriptTags 吗？

是的，建议在确认新追踪正常工作后，手动删除旧的 ScriptTags：

1. 进入 Shopify Admin → Settings → Customer events
2. 找到旧的 ScriptTags
3. 删除不再需要的 ScriptTags

## 下一步

- 📊 查看「监控」页面了解事件发送情况
- 🔔 配置告警接收异常通知
- 📋 使用「验收」功能定期验证追踪准确性
- 🎨 配置 Thank you 页面模块增强用户体验

## 需要帮助？

- 📖 查看完整用户指南: [USER_GUIDE.md](./USER_GUIDE.md)
- 🐛 遇到问题: 查看故障排除指南
- 💬 联系支持: 通过应用内支持入口

