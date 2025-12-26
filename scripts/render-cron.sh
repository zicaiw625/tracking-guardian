#!/bin/bash
#
# Render Cron Job Script
# 用于调用 /api/cron 端点执行定时任务
#
# 使用方式:
#   1. Render Cron Job Command:
#      ./scripts/render-cron.sh
#
#   2. 本地测试（需设置环境变量）:
#      CRON_SECRET=your-secret APP_URL=https://your-app.onrender.com ./scripts/render-cron.sh
#
#   3. 带重放保护的调用:
#      CRON_SECRET=your-secret APP_URL=https://your-app.onrender.com REPLAY_PROTECTION=true ./scripts/render-cron.sh
#

set -e

# 配置
APP_URL="${APP_URL:-https://tracking-guardian.onrender.com}"
CRON_ENDPOINT="${APP_URL}/api/cron"
CRON_SECRET="${CRON_SECRET:?Error: CRON_SECRET environment variable is required}"
TIMEOUT="${TIMEOUT:-300}"  # 5 分钟超时
REPLAY_PROTECTION="${REPLAY_PROTECTION:-false}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}[Cron] Starting cron job execution...${NC}"
echo "[Cron] Endpoint: ${CRON_ENDPOINT}"
echo "[Cron] Timeout: ${TIMEOUT}s"

# 构建 headers
HEADERS=(-H "Authorization: Bearer ${CRON_SECRET}")
HEADERS+=(-H "Content-Type: application/json")
HEADERS+=(-H "User-Agent: RenderCronJob/1.0")

# 添加重放保护 headers（可选，用于增强安全性）
if [ "${REPLAY_PROTECTION}" = "true" ]; then
    TIMESTAMP=$(date +%s)
    # 使用 OpenSSL 生成 HMAC-SHA256 签名
    SIGNATURE=$(echo -n "${TIMESTAMP}" | openssl dgst -sha256 -hmac "${CRON_SECRET}" | sed 's/^.* //')
    HEADERS+=(-H "X-Cron-Timestamp: ${TIMESTAMP}")
    HEADERS+=(-H "X-Cron-Signature: ${SIGNATURE}")
    echo "[Cron] Replay protection enabled (timestamp: ${TIMESTAMP})"
fi

# 执行请求
echo "[Cron] Sending POST request..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    "${HEADERS[@]}" \
    --max-time "${TIMEOUT}" \
    "${CRON_ENDPOINT}" 2>&1)

# 解析响应
HTTP_CODE=$(echo "${RESPONSE}" | tail -n 1)
BODY=$(echo "${RESPONSE}" | sed '$d')

echo "[Cron] Response code: ${HTTP_CODE}"

# 检查结果
if [ "${HTTP_CODE}" = "200" ]; then
    echo -e "${GREEN}[Cron] ✓ Cron job executed successfully${NC}"
    echo "[Cron] Response: ${BODY}"
    exit 0
elif [ "${HTTP_CODE}" = "429" ]; then
    echo -e "${YELLOW}[Cron] ⚠ Rate limited, will retry next cycle${NC}"
    echo "[Cron] Response: ${BODY}"
    exit 0  # 不算失败，下次会重试
elif [ "${HTTP_CODE}" = "409" ]; then
    echo -e "${YELLOW}[Cron] ⚠ Skipped - another instance is running${NC}"
    echo "[Cron] Response: ${BODY}"
    exit 0  # 分布式锁生效，不算失败
elif [ "${HTTP_CODE}" = "401" ] || [ "${HTTP_CODE}" = "403" ]; then
    echo -e "${RED}[Cron] ✗ Authentication failed${NC}"
    echo "[Cron] Response: ${BODY}"
    echo "[Cron] Please check CRON_SECRET configuration"
    exit 1
elif [ "${HTTP_CODE}" = "503" ]; then
    echo -e "${RED}[Cron] ✗ Service unavailable${NC}"
    echo "[Cron] Response: ${BODY}"
    exit 1
else
    echo -e "${RED}[Cron] ✗ Unexpected response code: ${HTTP_CODE}${NC}"
    echo "[Cron] Response: ${BODY}"
    exit 1
fi

