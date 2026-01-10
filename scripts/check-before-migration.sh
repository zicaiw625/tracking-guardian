#!/bin/bash

DATABASE_URL="postgresql://tracking_guardian_user:xQI5eAKFVwYXmnrrVtngV3NpaLh2bQhx@dpg-d51ta6uuk2gs73a4a7l0-a.singapore-postgres.render.com/tracking_guardian?sslmode=require"

echo "检查数据库连接..."
psql "$DATABASE_URL" -c "SELECT version();" > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ 无法连接到数据库，请检查连接字符串"
  exit 1
fi

echo "✅ 数据库连接正常"
echo ""

echo "检查 PixelEventReceipt 表结构..."
psql "$DATABASE_URL" -c "\d \"PixelEventReceipt\"" 2>&1 | grep -E "(eventId|event_id)" > /dev/null
if [ $? -eq 0 ]; then
  echo "⚠️  表已存在 eventId 字段，跳过迁移"
  exit 0
fi

echo "检查现有数据..."
RECORD_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM \"PixelEventReceipt\";" 2>&1 | xargs)
echo "当前 PixelEventReceipt 表中有 $RECORD_COUNT 条记录"

if [ "$RECORD_COUNT" -gt "0" ]; then
  echo "⚠️  检测到现有数据，迁移将使用 orderKey 或 id 填充 eventId 字段"
  echo "正在检查 orderKey 字段..."
  ORDERKEY_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM \"PixelEventReceipt\" WHERE \"orderKey\" IS NOT NULL;" 2>&1 | xargs)
  echo "有 $ORDERKEY_COUNT 条记录包含 orderKey"
fi

echo ""
echo "准备执行迁移..."
echo "迁移内容："
echo "  1. 添加 eventId 字段（TEXT，允许 NULL）"
echo "  2. 为现有记录填充 eventId（使用 orderKey 或 id）"
echo "  3. 设置 eventId 为 NOT NULL"
echo "  4. 创建唯一索引 (shopId, eventId, eventType)"
echo "  5. 创建 eventId 索引"
echo ""

read -p "是否继续执行迁移？(y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "迁移已取消"
  exit 0
fi

echo ""
echo "开始执行迁移..."

psql "$DATABASE_URL" -f prisma/migrations/20260111000000_add_eventid_to_pixel_event_receipt/migration.sql

if [ $? -eq 0 ]; then
  echo "✅ 迁移成功完成！"
  echo ""
  echo "验证迁移结果..."
  
  psql "$DATABASE_URL" -c "SELECT COUNT(*) as total, COUNT(\"eventId\") as with_event_id FROM \"PixelEventReceipt\";"
  
  psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename = 'PixelEventReceipt' AND indexname LIKE '%eventId%';"
  
  echo ""
  echo "✅ 验证完成，请运行: pnpm prisma generate"
else
  echo ""
  echo "❌ 迁移失败"
  echo ""
  echo "请检查错误信息，可能需要手动执行 SQL"
  exit 1
fi
