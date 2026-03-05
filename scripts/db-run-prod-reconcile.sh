#!/bin/bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "错误: DATABASE_URL 环境变量未设置"
  exit 1
fi

if [ "${MAINTENANCE_CONFIRMED:-false}" != "true" ]; then
  echo "错误: 生产执行前必须显式确认维护窗口"
  echo "请设置 MAINTENANCE_CONFIRMED=true 后重试"
  exit 1
fi

echo "步骤 1/6: 执行 preflight"
bash scripts/db-preflight-check.sh

echo "步骤 2/6: 导出迁移状态"
bash scripts/db-export-migration-state.sh

echo "步骤 3/6: 执行备份"
bash scripts/db-backup.sh

echo "步骤 4/6: 执行迁移"
pnpm db:deploy

echo "步骤 5/6: 迁移后核验"
bash scripts/db-preflight-check.sh

echo "步骤 6/6: 运行快速 smoke tests"
pnpm test -- tests/services/billing-gate.test.ts tests/pixel/consent.test.ts

echo "生产对齐执行完成"
