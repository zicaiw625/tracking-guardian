#!/bin/bash

# P0: v1.0 版本 PII 清理验证脚本
# 此脚本用于验证代码库中是否还有残留的 PII/PCD 相关代码

set -e

echo "========================================="
echo "PII/PCD 清理验证脚本"
echo "========================================="
echo ""

ERRORS=0
WARNINGS=0

# 定义要检查的关键字
KEYWORDS=(
  "PCD_CONFIG"
  "piiEnabled"
  "pcdAcknowledged"
  "isPiiFullyEnabled"
  "hashPII"
  "buildMetaHashedUserData"
  "buildTikTokHashedUserData"
  "extractPIISafely"
  "user_data"
  "email_hash"
  "phone_hash"
  "x-forwarded-for"
  "ipAddress"
  "userAgent"
)

# 排除的文件和目录
EXCLUDE_PATTERNS=(
  "node_modules"
  ".git"
  "dist"
  "build"
  "*.md"
  "FINAL_PII_CLEANUP_REPORT.md"
  "PII_CLEANUP_COMPLETE.md"
  "PII_CLEANUP_SUMMARY.md"
  "scripts/verify-pii-cleanup.sh"
)

# 排除的注释模式（允许在注释中提及）
ALLOWED_COMMENT_PATTERNS=(
  "P0-1"
  "P0-2"
  "P0-3"
  "P0-4"
  "v1.0"
  "不包含"
  "已移除"
  "已删除"
  "已清理"
)

echo "检查 1: 搜索残留的关键字..."
echo "----------------------------------------"

for keyword in "${KEYWORDS[@]}"; do
  echo "检查: $keyword"
  
  # 构建排除模式
  EXCLUDE_ARGS=()
  for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    EXCLUDE_ARGS+=("--exclude-dir=$pattern" "--exclude=$pattern")
  done
  
  # 搜索关键字（排除注释中的提及）
  RESULTS=$(grep -r "$keyword" \
    --include="*.ts" \
    --include="*.tsx" \
    --include="*.js" \
    --include="*.jsx" \
    --include="*.toml" \
    --include="*.prisma" \
    "${EXCLUDE_ARGS[@]}" \
    . 2>/dev/null | grep -v "^Binary" || true)
  
  if [ -n "$RESULTS" ]; then
    # 过滤掉允许的注释模式
    FILTERED=$(echo "$RESULTS" | grep -v "$(IFS='|'; echo "${ALLOWED_COMMENT_PATTERNS[*]}")" || true)
    
    if [ -n "$FILTERED" ]; then
      echo "  ❌ 发现残留:"
      echo "$FILTERED" | sed 's/^/    /'
      ERRORS=$((ERRORS + 1))
    else
      echo "  ⚠️  仅在注释中发现（允许）"
      WARNINGS=$((WARNINGS + 1))
    fi
  else
    echo "  ✅ 未发现"
  fi
  echo ""
done

echo "检查 2: 验证 shopify.app.toml..."
echo "----------------------------------------"

if grep -q "read_orders" shopify.app.toml 2>/dev/null; then
  echo "  ❌ shopify.app.toml 中仍包含 read_orders scope"
  ERRORS=$((ERRORS + 1))
else
  echo "  ✅ shopify.app.toml 中不包含 read_orders scope"
fi

if grep -q "orders/paid\|orders/cancelled\|orders/updated\|refunds/create" shopify.app.toml 2>/dev/null; then
  echo "  ❌ shopify.app.toml 中仍包含订单相关 webhooks"
  ERRORS=$((ERRORS + 1))
else
  echo "  ✅ shopify.app.toml 中不包含订单相关 webhooks"
fi

echo ""
echo "检查 3: 验证 Prisma schema..."
echo "----------------------------------------"

if grep -q "piiEnabled\|pcdAcknowledged\|ipAddress\|userAgent" prisma/schema.prisma 2>/dev/null; then
  echo "  ❌ Prisma schema 中仍包含 PII 相关字段"
  ERRORS=$((ERRORS + 1))
else
  echo "  ✅ Prisma schema 中不包含 PII 相关字段"
fi

echo ""
echo "========================================="
echo "验证结果"
echo "========================================="

if [ $ERRORS -eq 0 ]; then
  echo "✅ 所有检查通过！代码库已完全清理 PII/PCD 相关代码。"
  exit 0
else
  echo "❌ 发现 $ERRORS 个错误，$WARNINGS 个警告"
  echo ""
  echo "请修复上述问题后重新运行此脚本。"
  exit 1
fi

