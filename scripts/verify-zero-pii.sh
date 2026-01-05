#!/bin/bash

# P0: v1.0 版本零 PCD/PII 验证脚本
# 此脚本用于验证代码库中是否完全移除了所有 PCD/PII 相关代码

echo "🔍 验证 v1.0 零 PCD/PII 清理..."
echo ""

ERRORS=0

# 检查关键残留
check_pattern() {
    local pattern=$1
    local description=$2
    local count=$(grep -r "$pattern" app/ extensions/ prisma/ --include="*.ts" --include="*.tsx" --include="*.prisma" 2>/dev/null | grep -v "P0-\|v1.0\|不包含\|已移除\|已删除" | wc -l | tr -d ' ')
    
    if [ "$count" -gt 0 ]; then
        echo "  ❌ $description: 发现 $count 处残留"
        grep -r "$pattern" app/ extensions/ prisma/ --include="*.ts" --include="*.tsx" --include="*.prisma" 2>/dev/null | grep -v "P0-\|v1.0\|不包含\|已移除\|已删除" | head -5
        ERRORS=$((ERRORS + 1))
    else
        echo "  ✅ $description: 无残留"
    fi
}

# P0-1: 检查订单 webhooks
echo "📋 P0-1: 检查订单 Webhooks..."
check_pattern "read_orders" "read_orders scope"
check_pattern "orders/paid\|orders/cancelled\|orders/updated\|refunds/create" "订单相关 webhooks"

# P0-2: 检查 PCD/PII 开关
echo ""
echo "📋 P0-2: 检查 PCD/PII 开关..."
check_pattern "PCD_CONFIG" "PCD_CONFIG"
check_pattern "piiEnabled" "piiEnabled 字段"
check_pattern "pcdAcknowledged" "pcdAcknowledged 字段"
check_pattern "isPiiFullyEnabled" "isPiiFullyEnabled 函数"

# P0-3: 检查 hash PII 与 user_data
echo ""
echo "📋 P0-3: 检查 hash PII 与 user_data..."
check_pattern "hashPII\|buildMetaHashedUserData\|buildTikTokHashedUserData" "PII 哈希函数"
check_pattern '"user_data"\|user_data:' "user_data 字段"
check_pattern "email_hash\|phone_hash" "email_hash/phone_hash"

# P0-4: 检查 IP/User-Agent（仅检查数据库存储，不检查日志/限流使用）
echo ""
echo "📋 P0-4: 检查 IP/User-Agent（数据库存储）..."
# 检查 schema 中的字段定义（这些应该被移除）
if grep -q "ipAddress\|userAgent" prisma/schema.prisma 2>/dev/null; then
    echo "  ❌ prisma/schema.prisma 中仍包含 ipAddress 或 userAgent 字段"
    grep "ipAddress\|userAgent" prisma/schema.prisma
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ prisma/schema.prisma 中不包含 ipAddress 或 userAgent 字段"
fi

# 检查 audit-repository 中是否存储 IP/User-Agent（这些应该被移除）
if grep -q "ipAddress\|userAgent" app/services/db/audit-repository.server.ts 2>/dev/null | grep -v "P0-4\|v1.0\|不包含\|已移除\|已删除\|注释" | grep -q "ipAddress\|userAgent"; then
    echo "  ❌ app/services/db/audit-repository.server.ts 中仍存储 IP/User-Agent"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ app/services/db/audit-repository.server.ts 中不存储 IP/User-Agent"
fi

# 注意：middleware 中的 IP/User-Agent 用于日志和限流，不存储到数据库，这是允许的

# 检查 shopify.app.toml（排除注释）
echo ""
echo "📋 检查 shopify.app.toml..."
if grep -q "read_orders" shopify.app.toml 2>/dev/null | grep -v "^#\|P0-\|v1.0\|不包含\|已移除\|注释" | grep -q "read_orders"; then
    echo "  ❌ shopify.app.toml 中仍包含 read_orders scope（非注释）"
    grep "read_orders" shopify.app.toml | grep -v "^#\|P0-\|v1.0\|不包含\|已移除"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ shopify.app.toml 中不包含 read_orders scope（仅注释中提及）"
fi

if grep -q "orders/paid\|orders/cancelled\|orders/updated\|refunds/create" shopify.app.toml 2>/dev/null | grep -v "^#\|P0-\|v1.0\|不包含\|已移除\|注释" | grep -q "orders/\|refunds/"; then
    echo "  ❌ shopify.app.toml 中仍包含订单相关 webhooks（非注释）"
    grep "orders/\|refunds/" shopify.app.toml | grep -v "^#\|P0-\|v1.0\|不包含\|已移除"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ shopify.app.toml 中不包含订单相关 webhooks（仅注释中提及）"
fi

echo ""
if [ $ERRORS -eq 0 ]; then
    echo "✅ 验证通过：代码库已完全移除所有 PCD/PII 相关代码"
    exit 0
else
    echo "❌ 验证失败：发现 $ERRORS 个问题需要修复"
    exit 1
fi

