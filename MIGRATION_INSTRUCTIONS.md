# 数据库迁移执行说明

## 迁移内容

本次迁移为 `AuditAsset` 表添加以下字段：
- `priority` (INTEGER) - 优先级分数（1-10）
- `estimatedTimeMinutes` (INTEGER) - 预计迁移时间（分钟）
- `dependencies` (JSONB) - 依赖关系数组

## 执行方式

### 方式 1：使用 psql 命令行工具（推荐）

```bash
# 使用提供的连接字符串执行 SQL 文件
psql "postgresql://tracking_guardian_user:xQI5eAKFVwYXmnrrVtngV3NpaLh2bQhx@dpg-d51ta6uuk2gs73a4a7l0-a.singapore-postgres.render.com/tracking_guardian?sslmode=require" -f migration_manual.sql
```

### 方式 2：使用 Prisma Migrate（如果 TLS 问题已解决）

```bash
# 设置环境变量
export DATABASE_URL="postgresql://tracking_guardian_user:xQI5eAKFVwYXmnrrVtngV3NpaLh2bQhx@dpg-d51ta6uuk2gs73a4a7l0-a.singapore-postgres.render.com/tracking_guardian?sslmode=require"

# 执行迁移
pnpm prisma migrate deploy
```

### 方式 3：在 Render Dashboard 中执行

1. 登录 [Render Dashboard](https://dashboard.render.com/)
2. 找到您的 PostgreSQL 数据库服务
3. 点击 "Connect" 或 "Shell"
4. 复制 `migration_manual.sql` 文件中的 SQL 语句
5. 在数据库控制台中执行

### 方式 4：使用数据库管理工具

使用 pgAdmin、DBeaver 或其他 PostgreSQL 管理工具：
1. 连接到数据库
2. 打开 `migration_manual.sql` 文件
3. 执行所有 SQL 语句

## 验证迁移

执行以下 SQL 查询验证迁移是否成功：

```sql
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'AuditAsset' 
    AND column_name IN ('priority', 'estimatedTimeMinutes', 'dependencies')
ORDER BY column_name;
```

应该返回 3 行数据，分别对应三个新字段。

## 回滚（如果需要）

如果需要回滚迁移，执行以下 SQL：

```sql
-- 删除索引
DROP INDEX IF EXISTS "AuditAsset_priority_idx";
DROP INDEX IF EXISTS "AuditAsset_estimatedTimeMinutes_idx";

-- 删除字段
ALTER TABLE "AuditAsset" DROP COLUMN IF EXISTS "priority";
ALTER TABLE "AuditAsset" DROP COLUMN IF EXISTS "estimatedTimeMinutes";
ALTER TABLE "AuditAsset" DROP COLUMN IF EXISTS "dependencies";
```

## 注意事项

- 迁移是安全的，使用 `IF NOT EXISTS` 确保不会重复执行
- 新字段允许 NULL 值，不会影响现有数据
- 索引会在字段创建后自动创建，提升查询性能

