# App Store 审核准备清单

## 一、功能测试

### 1.1 核心功能验证
- [ ] **Audit 扫描功能**
  - [ ] 自动扫描 ScriptTags 正常工作
  - [ ] 手动分析脚本内容正常工作
  - [ ] 风险评分计算准确
  - [ ] 平台识别准确

- [ ] **像素迁移功能**
  - [ ] 向导流程完整（5 步骤）
  - [ ] 凭证加密存储
  - [ ] 事件映射配置正确
  - [ ] 测试环境验证通过
  - [ ] Live 环境切换正常

- [ ] **UI 模块功能**
  - [ ] 订单追踪模块正常显示
  - [ ] 问卷模块正常收集数据
  - [ ] 再购按钮正常工作
  - [ ] 帮助中心正常显示

- [ ] **验收测试功能**
  - [ ] 验收向导正常生成测试清单
  - [ ] 事件分析准确
  - [ ] 报告导出正常（PDF/CSV）

- [ ] **监控告警功能**
  - [ ] 事件成功率监控正常
  - [ ] 缺参率检测准确
  - [ ] 事件量骤降检测正常
  - [ ] 告警通知发送正常

### 1.2 错误处理
- [x] 所有 API 调用都有错误处理 (`app/middleware/error-handler.ts`)
- [x] 用户友好的错误提示 (不暴露内部错误信息)
- [x] 错误日志记录完整 (`logger.error` 记录)
- [x] 错误 ID 生成用于追踪 (`errorId`)
- [x] 网络错误有重试机制 (在服务层实现)
- [x] 错误响应格式统一 (`ApiErrorResponse`)
- [x] 生产环境不暴露堆栈信息
- [x] Rate limiting 错误处理 (429 状态码)
- [x] 验证错误处理 (400 状态码)
- [x] 认证错误处理 (401 状态码)
- [x] 权限错误处理 (403 状态码)
- [x] 资源未找到错误处理 (404 状态码)

### 1.3 边界情况
- [ ] 空数据状态处理
- [ ] 大量数据性能测试
- [ ] 并发请求处理
- [ ] 超时处理

## 二、权限验证

### 2.1 权限范围检查
- [ ] 只申请必要权限
- [ ] 权限用途文档化
- [ ] 权限最小化原则

### 2.2 权限使用验证
- [ ] `read_customer_events` - 用于 Web Pixel 事件接收
- [ ] `read_orders` - 用于订单数据对账
- [ ] `write_script_tags` - 已废弃，不再使用
- [ ] `read_script_tags` - 用于扫描现有 ScriptTags

## 三、安全审计

### 3.1 数据加密
- [x] Access Token 使用 AES-256-GCM 加密 (`app/utils/token-encryption.ts`)
- [x] API 凭证使用 AES-256-GCM 加密
- [x] Ingestion Secret 加密存储
- [x] 加密密钥管理安全 (`app/utils/crypto.server.ts`)
- [x] 启动时验证加密配置 (`app/utils/secrets.ts`)

### 3.2 API 安全
- [x] HMAC 签名验证 (`app/utils/security.ts`)
- [x] 请求来源验证 (`app/middleware/validation.ts`)
- [x] Rate limiting 实现 (`app/middleware/rate-limit.ts`)
- [x] SQL 注入防护 (`app/utils/security.ts`)
- [x] XSS 防护 (`app/utils/security.ts` - 安全响应头)
- [x] 时间安全比较 (`timingSafeEqual`)

### 3.3 权限控制
- [ ] 多店权限隔离
- [ ] 工作区权限控制
- [ ] 操作审计日志

## 四、隐私合规

### 4.1 GDPR 合规
- [x] `customers/data_request` webhook 实现 (`app/webhooks/handlers/gdpr.handler.ts`)
- [x] `customers/redact` webhook 实现
- [x] `shop/redact` webhook 实现
- [x] 数据删除功能完整 (`app/services/gdpr/handlers/`)
- [x] GDPR 任务队列处理 (`app/services/gdpr/job-processor.ts`)
- [x] Cron 任务处理 GDPR 任务 (`app/cron/tasks/index.ts`)

### 4.2 数据收集透明度
- [ ] 隐私政策完整
- [ ] 数据收集说明清晰
- [ ] 数据使用目的明确
- [ ] 第三方共享说明

### 4.3 同意管理
- [ ] 同意状态检查
- [ ] 同意信号处理
- [ ] 无同意时不发送数据

## 五、用户体验

### 5.1 界面友好性
- [ ] 所有页面都有清晰的说明
- [ ] 错误提示友好
- [ ] 加载状态显示
- [ ] 空状态处理

### 5.2 性能
- [ ] 页面加载速度合理
- [ ] API 响应时间合理
- [ ] 大数据量处理优化

### 5.3 可访问性
- [ ] 键盘导航支持
- [ ] 屏幕阅读器支持
- [ ] 颜色对比度符合标准

## 六、测试店铺准备

### 6.1 测试店铺信息
- [ ] Demo store URL: [待填写]
- [ ] 测试账号: [待填写]
- [ ] 测试数据: [待填写]

### 6.2 测试场景
- [ ] 新安装流程
- [ ] Audit 扫描流程
- [ ] 像素迁移流程
- [ ] 验收测试流程
- [ ] 监控告警流程

### 6.3 测试凭据
- [ ] GA4 Measurement ID 和 API Secret
- [ ] Meta Pixel ID 和 Access Token
- [ ] TikTok Pixel ID 和 Access Token
- [ ] Pinterest Tag ID 和 Access Token

## 七、文档准备

### 7.1 必需文档
- [x] App Store Listing 文案
- [x] 隐私政策
- [x] 用户指南
- [ ] API 文档（如需要）

### 7.2 截图准备
- [ ] Dashboard 首页截图
- [ ] Audit 扫描报告截图
- [ ] 像素迁移向导截图
- [ ] 验收测试页面截图
- [ ] 监控面板截图

### 7.3 视频准备
- [ ] 功能演示视频（2-3 分钟）
- [ ] 验收测试演示视频（1 分钟）

## 八、审核前检查

### 8.1 代码质量
- [ ] 无控制台错误
- [ ] 无 TypeScript 错误
- [ ] 无 Linter 错误
- [ ] 代码注释完整

### 8.2 部署检查
- [ ] 生产环境部署成功
- [ ] 所有功能在生产环境正常
- [ ] 性能指标符合要求
- [ ] 监控告警正常

### 8.3 最终验证
- [ ] 完整流程测试通过
- [ ] 所有错误场景测试通过
- [ ] 性能测试通过
- [ ] 安全测试通过

---

**审核提交日期**: [待填写]
**审核状态**: [待填写]
**审核反馈**: [待填写]

