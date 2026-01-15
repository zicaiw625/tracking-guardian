#!/bin/bash

if [ -z "$DATABASE_URL" ]; then
  echo "错误: DATABASE_URL 环境变量未设置"
  echo "请设置 DATABASE_URL 环境变量，例如："
  echo "  export DATABASE_URL='postgresql://user:password@host:port/database?sslmode=require'"
  exit 1
fi

echo "正在执行数据库迁移..."
echo "数据库连接: $(echo $DATABASE_URL | sed 's/:[^:@]*@/:***@/')"


pnpm prisma migrate deploy

if [ $? -eq 0 ]; then
  echo "✅ 迁移成功完成！"
else
  echo ""
  echo "❌ 迁移失败"
  echo ""
  echo "可能的解决方案："
  echo "1. 确认数据库服务正在运行"
  echo "2. 检查连接字符串是否正确"
  echo "3. 如果遇到 TLS 证书错误，尝试："
  echo "   - 使用 Render 的内部网络连接（如果在 Render 平台上）"
  echo "   - 检查防火墙设置"
  echo "   - 联系 Render 支持检查 SSL 配置"
  echo ""
  echo "或者，您可以手动执行迁移 SQL 文件："
  echo "   psql \$DATABASE_URL -f prisma/migrations/[migration_name]/migration.sql"
  exit 1
fi
