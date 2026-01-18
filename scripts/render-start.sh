#!/bin/bash
set -e

# Render 启动脚本 - 在启动前执行数据库迁移
# 添加重试逻辑以处理数据库初始化延迟

MAX_RETRIES=5
RETRY_DELAY=3

echo "Starting database migration..."

for i in $(seq 1 $MAX_RETRIES); do
  echo "Migration attempt $i/$MAX_RETRIES..."
  
  if pnpm db:deploy; then
    echo "Database migration completed successfully"
    break
  else
    if [ $i -eq $MAX_RETRIES ]; then
      echo "Database migration failed after $MAX_RETRIES attempts"
      exit 1
    fi
    echo "Migration failed, retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
  fi
done

echo "Starting application..."
exec pnpm start
