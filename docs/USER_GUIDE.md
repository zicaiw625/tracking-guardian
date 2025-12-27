# Tracking Guardian 用户操作指南

## 目录

1. [快速入门](#快速入门)
2. [安装与配置](#安装与配置)
3. [风险扫描与评估](#风险扫描与评估)
4. [迁移向导](#迁移向导)
5. [平台配置](#平台配置)
6. [TY/OS 模块配置](#tyos-模块配置)
7. [监控与告警](#监控与告警)
8. [计费与套餐](#计费与套餐)
9. [常见问题](#常见问题)

---

## 快速入门

### 什么是 Tracking Guardian？

Tracking Guardian 是一款专为 Shopify 商家设计的追踪迁移工具，帮助您：

- 🔍 **扫描风险**：识别店铺中即将失效的追踪脚本
- 🚀 **一键迁移**：将旧追踪代码迁移到 Shopify 新平台
- 📊 **监控对账**：确保追踪数据完整性
- 📋 **模块配置**：在 Thank You/Order Status 页面添加功能模块

### 15 分钟快速上手

1. **安装应用** → 从 Shopify App Store 安装 Tracking Guardian
2. **扫描店铺** → 自动检测现有追踪脚本和潜在风险
3. **选择迁移** → 根据扫描报告选择需要迁移的平台
4. **配置凭证** → 输入 GA4/Meta/TikTok 等平台的 API 凭证
5. **验证追踪** → 完成测试订单，确认追踪正常

---

## 安装与配置

### 安装步骤

1. 访问 [Shopify App Store](https://apps.shopify.com) 搜索 "Tracking Guardian"
2. 点击 **安装应用**
3. 授权应用访问所需权限
4. 完成安装后自动跳转到应用仪表盘

### 权限说明

应用需要以下权限：

| 权限 | 用途 |
|------|------|
| `read_script_tags` | 扫描现有追踪脚本 |
| `read_pixels` / `write_pixels` | 管理 Web Pixel |
| `read_orders` | 对账验证订单数据 |
| `read_customer_events` | 订阅标准事件 |

### 初始设置向导

安装后，应用会引导您完成以下设置：

1. **店铺信息确认** - 确认店铺域名和时区
2. **初次扫描** - 自动扫描现有追踪配置
3. **套餐选择** - 选择适合您的订阅计划
4. **迁移规划** - 根据扫描结果制定迁移计划

---

## 风险扫描与评估

### 扫描报告

进入 **扫描** 页面，可以查看完整的风险评估报告：

#### 扫描内容

- **Script Tags** - 检测所有已安装的脚本标签
- **Web Pixels** - 检测现有像素配置
- **平台识别** - 自动识别 GA4、Meta、TikTok 等平台

#### 风险等级

| 等级 | 说明 | 建议操作 |
|------|------|----------|
| 🔴 Critical | 即将失效，急需迁移 | 立即迁移 |
| 🟠 High | 高风险，建议尽快处理 | 尽快迁移 |
| 🟡 Medium | 中等风险 | 规划迁移 |
| 🟢 Low | 低风险或已迁移 | 持续监控 |

### 迁移倒计时

- **Plus 商家**：2026 年 1 月前需完成迁移
- **非 Plus 商家**：2026 年 8 月 26 日前需完成迁移

### 导出报告

点击 **导出报告** 可下载 PDF 格式的完整扫描报告，包含：
- 风险项清单
- 迁移建议
- 预计工时评估

---

## 迁移向导

### 迁移步骤

#### 1. 选择迁移目标

根据扫描报告，选择需要迁移的平台：

- **GA4** - Google Analytics 4 Measurement Protocol
- **Meta CAPI** - Facebook Conversions API
- **TikTok Events API** - TikTok 服务端事件
- **自定义 Webhook** - 发送到自定义端点

#### 2. 启用 App Pixel

点击 **启用 App Pixel** 按钮，系统会自动：

1. 创建 Web Pixel 扩展
2. 配置事件订阅
3. 设置同意管理

#### 3. 配置平台凭证

根据选择的平台，输入相应的 API 凭证：

**GA4 配置**
- Measurement ID（格式：G-XXXXXXXX）
- API Secret（在 GA4 管理后台创建）

**Meta CAPI 配置**
- Pixel ID（15-16位数字）
- Access Token（在 Events Manager 生成）
- Test Event Code（可选，用于测试）

**TikTok Events API 配置**
- Pixel ID
- Access Token

#### 4. 测试验证

完成配置后：

1. 在测试模式下创建一笔订单
2. 检查各平台是否收到事件
3. 确认参数完整性（currency、value、items）

#### 5. 清理旧脚本

验证新追踪正常后：

1. 禁用或删除旧 Script Tags
2. 清理 Additional Scripts 中的旧代码
3. 记录清理操作以便回滚

### 迁移配方

应用内置多种 **迁移配方**，针对常见场景提供一键解决方案：

| 配方 | 描述 | 难度 |
|------|------|------|
| GA4 基础 | gtag.js → Measurement Protocol | 简单 |
| Meta CAPI | fbq → Conversions API | 简单 |
| TikTok Events | ttq → Events API | 简单 |
| 购后问卷 | 第三方问卷 → Checkout UI | 简单 |
| 自定义 Webhook | 任意事件 → HTTP 端点 | 中等 |

---

## 平台配置

### GA4 配置详解

#### 获取凭证

1. 登录 [Google Analytics](https://analytics.google.com)
2. 进入 **管理** → **数据流**
3. 选择网站数据流
4. 复制 **Measurement ID**（G-XXXXXXXX）
5. 点击 **Measurement Protocol API secrets**
6. 创建并复制 **API Secret**

#### 事件映射

| Shopify 事件 | GA4 事件 |
|-------------|----------|
| purchase | purchase |
| begin_checkout | begin_checkout |
| add_to_cart | add_to_cart |
| view_item | view_item |

### Meta CAPI 配置详解

#### 获取凭证

1. 登录 [Meta Events Manager](https://www.facebook.com/events_manager)
2. 选择 Pixel
3. 进入 **设置** → **Conversions API**
4. 生成 **Access Token**
5. 复制 **Pixel ID**

#### 事件映射

| Shopify 事件 | Meta 事件 |
|-------------|----------|
| purchase | Purchase |
| begin_checkout | InitiateCheckout |
| add_to_cart | AddToCart |
| view_item | ViewContent |

#### 去重配置

使用 `event_id` 参数确保事件去重：
- 格式：`hash(order_id + event_name + timestamp_bucket)`
- 自动生成，无需手动配置

### TikTok Events API 配置详解

#### 获取凭证

1. 登录 [TikTok Ads Manager](https://ads.tiktok.com)
2. 进入 **工具** → **Events**
3. 选择 Pixel → **管理**
4. 生成 **Access Token**

---

## TY/OS 模块配置

### 可用模块

#### 1. 订单跟踪模块

在 Thank You / Order Status 页面显示：
- 物流链接
- 订单号复制按钮
- FAQ 链接

**配置项**：
- 显示/隐藏开关
- 自定义文案
- FAQ 链接 URL

#### 2. 客服入口模块

提供客服联系入口：
- 预填订单号和邮箱
- 支持邮件/WhatsApp/微信

**配置项**：
- 联系方式选择
- 帮助中心链接
- 预填字段配置

#### 3. 问卷模块

收集客户反馈：
- 单选/多选/文本输入
- 提交后保存到应用

**配置项**：
- 问卷标题
- 问题内容
- 选项列表
- Webhook URL（可选）

#### 4. 复购推荐模块

展示相关产品：
- 自动推荐
- 手动配置

### 启用模块

1. 进入 **设置** → **TY/OS 模块**
2. 开启需要的模块
3. 配置模块参数
4. 在 Shopify 后台启用 Checkout UI 扩展

---

## 监控与告警

### 对账报告

**事件对账** 功能验证追踪数据完整性：

1. 对比 Shopify 订单 webhook 与 pixel 事件
2. 在 5 分钟内检查事件到达
3. 验证参数完整性

#### 对账结果

| 状态 | 说明 |
|------|------|
| ✅ PASS | 事件正常接收 |
| ⚠️ WARN | 部分参数缺失 |
| ❌ FAIL | 事件未收到 |

### 告警配置

进入 **设置** → **告警配置**：

- **邮件告警** - 发送到指定邮箱
- **Slack 告警** - 发送到 Slack 频道（Growth+）
- **Webhook 告警** - 发送到自定义端点（Pro+）

### 告警类型

- 事件送达失败
- 参数缺失
- 对账失败率超阈值
- 月度配额接近上限

---

## 计费与套餐

### 套餐对比

| 功能 | 免费版 | 成长版 ($29/月) | 专业版 ($79/月) | 代理版 ($199/月) |
|------|--------|----------------|----------------|-----------------|
| 月度订单量 | 100 | 2,000 | 10,000 | 50,000 |
| 平台连接器 | 1 | 2 | 5 | 10 |
| 风险扫描 | ✅ | ✅ | ✅ | ✅ |
| App Pixel | - | ✅ | ✅ | ✅ |
| GA4/Meta/TikTok | - | ✅ | ✅ | ✅ |
| TY/OS 模块 | - | 基础 | 全部 | 全部 |
| 高级对账 | - | - | ✅ | ✅ |
| 自定义 Webhook | - | - | ✅ | ✅ |
| 多店铺 | - | - | - | ✅ (10个) |
| 白标报告 | - | - | - | ✅ |
| 优先支持 | - | - | ✅ | ✅ |

### 升级/降级

1. 进入 **设置** → **订阅管理**
2. 选择目标套餐
3. 确认变更
4. Shopify 会自动处理计费

### 试用期

- 成长版/专业版：7 天免费试用
- 代理版：14 天免费试用

---

## 常见问题

### 安装问题

**Q: 安装后看不到扫描结果？**

A: 请确保授权了 `read_script_tags` 权限，并等待几秒钟让扫描完成。

**Q: 如何重新扫描？**

A: 进入 **扫描** 页面，点击 **重新扫描** 按钮。

### 迁移问题

**Q: 启用 App Pixel 后旧追踪还能用吗？**

A: 可以。建议在确认新追踪正常后再禁用旧追踪，避免数据断档。

**Q: 迁移后数据会丢失吗？**

A: 不会。我们建议并行运行一段时间，确认新追踪正常后再清理旧代码。

**Q: 如何回滚迁移？**

A: 进入 **迁移** 页面，找到已应用的配方，点击 **回滚** 按钮。

### 对账问题

**Q: 对账显示 FAIL 怎么办？**

A: 检查以下几点：
1. 平台凭证是否正确
2. 事件是否被同意管理拦截
3. 平台 API 是否可用

**Q: 为什么有些订单没有对账？**

A: 可能是：
1. 订单在对账超时后才完成
2. 客户拒绝了追踪同意
3. 超出了月度配额

### 计费问题

**Q: 超出月度配额后会怎样？**

A: 超出配额后当月不再发送事件，下月自动恢复。建议升级套餐或设置配额告警。

**Q: 可以中途升级吗？**

A: 可以，Shopify 会按比例计算费用。

---

## 获取帮助

- 📧 **邮件支持**: support@trackingguardian.app
- 📖 **帮助文档**: https://docs.trackingguardian.app
- 💬 **在线客服**: 应用内右下角聊天按钮

---

*最后更新: 2025 年 12 月*

