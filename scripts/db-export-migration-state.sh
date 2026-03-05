#!/bin/bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "错误: DATABASE_URL 环境变量未设置"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${1:-ops/migrations/state-$STAMP}"
mkdir -p "$OUT_DIR"

echo "导出迁移状态到: $OUT_DIR"

pnpm prisma migrate status > "$OUT_DIR/migrate-status.txt"
pnpm prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma > "$OUT_DIR/migrate-diff.txt" || true

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL' > "$OUT_DIR/prisma_migrations.tsv"
\pset footer off
\pset tuples_only on
SELECT
  migration_name,
  started_at,
  finished_at,
  rolled_back_at,
  logs
FROM "_prisma_migrations"
ORDER BY started_at ASC;
SQL

git rev-parse HEAD > "$OUT_DIR/git-sha.txt"
echo "完成: 已导出迁移状态和版本指针"
