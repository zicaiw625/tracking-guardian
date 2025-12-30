# 数据库迁移执行说明

## 迁移内容

本次迁移添加了以下性能优化索引：

### AuditAsset 表
- `AuditAsset_shopId_migrationStatus_idx` - 优化按店铺和迁移状态查询
- `AuditAsset_shopId_riskLevel_idx` - 优化按店铺和风险等级查询
- `AuditAsset_shopId_category_riskLevel_idx` - 优化按店铺、分类和风险等级查询
- `AuditAsset_shopId_createdAt_idx` - 优化按店铺和时间范围查询

### VerificationRun 表
- `VerificationRun_shopId_status_idx` - 优化按店铺和状态查询
- `VerificationRun_shopId_createdAt_idx` - 优化按店铺和时间范围查询
- `VerificationRun_shopId_status_createdAt_idx` - 优化按店铺、状态和时间范围查询

## 执行方式

### 方式 1: 使用 psql 命令行工具（推荐）

```bash
psql "postgresql://tracking_guardian_user:xQI5eAKFVwYXmnrrVtngV3NpaLh2bQhx@dpg-d51ta6uuk2gs73a4a7l0-a.singapore-postgres.render.com/tracking_guardian?sslmode=require" -f migration_performance_indexes.sql
```

### 方式 2: 使用 Prisma Migrate（如果 SSL 连接正常）

```bash
DATABASE_URL="postgresql://tracking_guardian_user:xQI5eAKFVwYXmnrrVtngV3NpaLh2bQhx@dpg-d51ta6uuk2gs73a4a7l0-a.singapore-postgres.render.com/tracking_guardian?sslmode=require" pnpm db:deploy
```

### 方式 3: 使用数据库管理工具

1. 连接到数据库
2. 打开 `migration_performance_indexes.sql` 文件
3. 执行 SQL 语句

### 方式 4: 在 Render Dashboard 中执行

1. 登录 Render Dashboard
2. 进入 PostgreSQL 数据库页面
3. 打开 "Shell" 或 "Query" 标签
4. 复制 `migration_performance_indexes.sql` 的内容并执行

## 验证迁移

执行以下 SQL 查询验证索引是否创建成功：

```sql
SELECT 
    schemaname,
    tablename,
    indexname
FROM pg_indexes
WHERE tablename IN ('AuditAsset', 'VerificationRun')
    AND indexname LIKE '%shopId%'
ORDER BY tablename, indexname;
```

应该看到以下索引：
- AuditAsset_shopId_migrationStatus_idx
- AuditAsset_shopId_riskLevel_idx
- AuditAsset_shopId_category_riskLevel_idx
- AuditAsset_shopId_createdAt_idx
- VerificationRun_shopId_status_idx
- VerificationRun_shopId_createdAt_idx
- VerificationRun_shopId_status_createdAt_idx

## 注意事项

1. **索引创建时间**: 根据数据量大小，索引创建可能需要几分钟时间
2. **性能影响**: 创建索引期间可能会短暂影响数据库性能
3. **回滚**: 如果需要回滚，可以删除这些索引：
   ```sql
   DROP INDEX IF EXISTS "AuditAsset_shopId_migrationStatus_idx";
   DROP INDEX IF EXISTS "AuditAsset_shopId_riskLevel_idx";
   DROP INDEX IF EXISTS "AuditAsset_shopId_category_riskLevel_idx";
   DROP INDEX IF EXISTS "AuditAsset_shopId_createdAt_idx";
   DROP INDEX IF EXISTS "VerificationRun_shopId_status_idx";
   DROP INDEX IF EXISTS "VerificationRun_shopId_createdAt_idx";
   DROP INDEX IF EXISTS "VerificationRun_shopId_status_createdAt_idx";
   ```

## 预期效果

迁移完成后，以下查询性能将得到显著提升：
- Dashboard 数据加载（按店铺查询 AuditAsset）
- 迁移清单生成（按店铺、状态、风险等级查询）
- 验收报告查询（按店铺、状态、时间范围查询）

预计查询性能提升：**20-30%**
