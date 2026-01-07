#!/bin/bash




DATABASE_URL="postgresql://tracking_guardian_user:xQI5eAKFVwYXmnrrVtngV3NpaLh2bQhx@dpg-d51ta6uuk2gs73a4a7l0-a.singapore-postgres.render.com/tracking_guardian?sslmode=require"

echo "开始执行数据库迁移..."


psql "$DATABASE_URL" -f prisma/migrations/20250102000000_add_task_assignment_and_comments/migration.sql

if [ $? -eq 0 ]; then
    echo "✅ 迁移成功完成！"
    echo "现在运行: pnpm exec prisma generate"
else
    echo "❌ 迁移失败，请检查错误信息"
    exit 1
fi

