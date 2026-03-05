#!/bin/bash
set -euo pipefail

if [ -z "${CLONE_DATABASE_URL:-}" ]; then
  echo "错误: CLONE_DATABASE_URL 环境变量未设置"
  echo "示例: CLONE_DATABASE_URL='postgresql://...' bash scripts/db-rehearse-reconcile.sh"
  exit 1
fi

echo "在克隆库上执行预演..."
export DATABASE_URL="$CLONE_DATABASE_URL"

bash scripts/db-preflight-check.sh
bash scripts/db-export-migration-state.sh "ops/migrations/rehearsal-state-$(date +%Y%m%d-%H%M%S)"

echo "执行迁移部署..."
pnpm db:deploy

echo "迁移后再次核验..."
bash scripts/db-preflight-check.sh

echo "预演完成"
