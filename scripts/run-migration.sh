#!/bin/bash

if [ -z "$DATABASE_URL" ]; then
  echo "错误: DATABASE_URL 环境变量未设置"
  echo "请设置 DATABASE_URL 环境变量，例如："
  echo "  export DATABASE_URL='postgresql://user:password@host:port/database?sslmode=require'"
  exit 1
fi

echo "开始执行数据库迁移..."


psql "$DATABASE_URL" -f prisma/migrations/20250102000000_add_task_assignment_and_comments/migration.sql

if [ $? -eq 0 ]; then
    echo "✅ 迁移成功完成！"
    echo "现在运行: pnpm exec prisma generate"
else
    echo "❌ 迁移失败，请检查错误信息"
    exit 1
fi

