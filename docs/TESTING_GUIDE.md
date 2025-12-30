# 测试指南

## 测试策略

### 单元测试
- **目标**: 测试独立的函数和组件
- **覆盖率目标**: > 80%
- **工具**: Vitest

### 集成测试
- **目标**: 测试 API 端点和服务集成
- **覆盖率目标**: > 70%
- **工具**: Vitest + Supertest

### E2E 测试
- **目标**: 测试完整的用户流程
- **覆盖率目标**: 关键流程 100%
- **工具**: Playwright / Cypress

## 测试结构

```
tests/
├── unit/              # 单元测试
│   ├── services/      # 服务层测试
│   ├── utils/         # 工具函数测试
│   └── components/    # 组件测试
├── integration/       # 集成测试
│   ├── api/           # API 端点测试
│   ├── webhooks/      # Webhook 测试
│   └── services/      # 服务集成测试
└── e2e/               # E2E 测试
    ├── flows/         # 用户流程测试
    └── scenarios/     # 场景测试
```

## 关键测试场景

### 1. 安装与初始化
- [ ] OAuth 安装流程
- [ ] 自动体检功能
- [ ] 升级状态检查

### 2. Audit 扫描
- [ ] ScriptTags 扫描
- [ ] 平台识别
- [ ] 风险评分计算
- [ ] 迁移清单生成

### 3. 像素迁移
- [ ] 向导流程完整性
- [ ] 事件映射配置
- [ ] 凭证验证
- [ ] Web Pixel 创建

### 4. 事件对账
- [ ] 事件接收
- [ ] 参数验证
- [ ] 金额准确性检查
- [ ] 报告生成

### 5. 监控与告警
- [ ] 事件监控
- [ ] 告警触发
- [ ] 通知发送

### 6. Agency 功能
- [ ] 批量扫描
- [ ] 批量配置
- [ ] 报告导出

## 运行测试

### 运行所有测试
```bash
pnpm test
```

### 运行特定测试
```bash
pnpm test tests/services/scanner.test.ts
```

### 运行测试并生成覆盖率
```bash
pnpm test:coverage
```

### 运行 E2E 测试
```bash
pnpm test:e2e
```

## 测试最佳实践

### 1. 测试命名
- 使用描述性的测试名称
- 遵循 "should ... when ..." 模式

### 2. 测试隔离
- 每个测试独立运行
- 使用 beforeEach/afterEach 清理

### 3. Mock 外部依赖
- Mock API 调用
- Mock 数据库操作
- Mock 外部服务

### 4. 测试数据
- 使用工厂函数生成测试数据
- 避免硬编码数据

### 5. 断言
- 使用明确的断言
- 测试边界条件
- 测试错误情况

## CI/CD 集成

### GitHub Actions
```yaml
- name: Run tests
  run: pnpm test

- name: Generate coverage
  run: pnpm test:coverage

- name: Upload coverage
  uses: codecov/codecov-action@v3
```

## 测试覆盖率目标

| 模块 | 覆盖率目标 |
|------|-----------|
| Services | > 80% |
| Utils | > 90% |
| Components | > 70% |
| Routes | > 60% |
| 总体 | > 75% |

## 性能测试

### 负载测试
```bash
# 使用 k6
k6 run tests/performance/load-test.js
```

### 压力测试
```bash
# 使用 Artillery
artillery run tests/performance/stress-test.yml
```

## 测试数据管理

### 测试数据库
- 使用独立的测试数据库
- 每次测试前重置数据
- 使用事务回滚

### 测试用户
- 创建测试店铺账号
- 使用测试 API 密钥
- 隔离测试环境

## 持续改进

1. **定期审查测试**
   - 每月审查测试覆盖率
   - 识别缺失的测试

2. **重构测试**
   - 移除重复代码
   - 提高测试可读性

3. **性能优化**
   - 优化慢测试
   - 并行运行测试

