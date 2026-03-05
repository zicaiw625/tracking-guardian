#!/bin/bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "错误: DATABASE_URL 环境变量未设置"
  exit 1
fi

echo "1) 检查数据库连接..."
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT current_database(), now();"

echo "2) 检查 Prisma 迁移状态..."
pnpm prisma migrate status || true

echo "3) 检查 schema 漂移..."
pnpm prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma || true

echo "4) 检查关键表是否存在..."
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  to_regclass('"AuditLog"')          AS audit_log,
  to_regclass('"ExtensionError"')    AS extension_error,
  to_regclass('"WebhookLog"')        AS webhook_log,
  to_regclass('"GDPRJob"')           AS gdpr_job,
  to_regclass('"BatchAuditJob"')     AS batch_audit_job;
SQL

echo "Preflight 完成"
