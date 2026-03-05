#!/bin/bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "错误: DATABASE_URL 环境变量未设置"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${1:-ops/migrations/backups}"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/tracking-guardian-$STAMP.dump"

echo "开始备份数据库到: $OUT_FILE"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$OUT_FILE"
echo "完成: $OUT_FILE"
