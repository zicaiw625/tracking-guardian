#!/bin/bash















set -e


# 优先使用 SHOPIFY_APP_URL，如果没有则使用 APP_URL，最后使用默认值
if [ -n "${SHOPIFY_APP_URL}" ]; then
    APP_URL="${SHOPIFY_APP_URL}"
elif [ -n "${APP_URL}" ]; then
    APP_URL="${APP_URL}"
else
    APP_URL="https://tracking-guardian.onrender.com"
fi

# 验证 URL 格式
if [[ ! "${APP_URL}" =~ ^https?:// ]]; then
    echo "❌ Error: APP_URL or SHOPIFY_APP_URL must be a valid URL starting with http:// or https://"
    echo "   Current value: ${APP_URL}"
    echo "   Please set SHOPIFY_APP_URL or APP_URL environment variable"
    exit 1
fi

CRON_ENDPOINT="${APP_URL}/api/cron"
CRON_SECRET="${CRON_SECRET:?Error: CRON_SECRET environment variable is required}"
TIMEOUT="${TIMEOUT:-300}"
REPLAY_PROTECTION="${REPLAY_PROTECTION:-false}"


RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}[Cron] Starting cron job execution...${NC}"
echo "[Cron] Endpoint: ${CRON_ENDPOINT}"
echo "[Cron] Timeout: ${TIMEOUT}s"


HEADERS=(-H "Authorization: Bearer ${CRON_SECRET}")
HEADERS+=(-H "User-Agent: RenderCronJob/1.0")
HEADERS+=(-H "Prefer: respond-async")


if [ "${REPLAY_PROTECTION}" = "true" ]; then
    TIMESTAMP=$(date +%s)

    SIGNATURE=$(echo -n "${TIMESTAMP}" | openssl dgst -sha256 -hmac "${CRON_SECRET}" | sed 's/^.* //')
    HEADERS+=(-H "X-Cron-Timestamp: ${TIMESTAMP}")
    HEADERS+=(-H "X-Cron-Signature: ${SIGNATURE}")
    echo "[Cron] Replay protection enabled (timestamp: ${TIMESTAMP})"
fi


echo "[Cron] Sending POST request..."
# 临时关闭 set -e，以便 curl 失败时能捕获退出码和输出
set +e
RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    "${HEADERS[@]}" \
    --max-time "${TIMEOUT}" \
    "${CRON_ENDPOINT}" 2>&1)
CURL_EXIT=$?
set -e

HTTP_CODE=$(echo "${RESPONSE}" | tail -n 1)
BODY=$(echo "${RESPONSE}" | sed '$d')

echo "[Cron] Response code: ${HTTP_CODE}"

# curl 未收到 HTTP 响应（连接/解析/超时等）
if [ "${CURL_EXIT:-1}" -ne 0 ] || [ "${HTTP_CODE}" = "000" ] || [ -z "${HTTP_CODE}" ]; then
    echo -e "${RED}[Cron] ✗ Request failed (curl exit: ${CURL_EXIT}, HTTP: ${HTTP_CODE:-none})${NC}"
    echo "[Cron] Response/Error: ${BODY}"
    case "${CURL_EXIT}" in
        6)  echo "[Cron] Hint: Could not resolve host - check APP_URL/SHOPIFY_APP_URL and DNS" ;;
        7)  echo "[Cron] Hint: Connection refused - is the web service running and reachable?" ;;
        28) echo "[Cron] Hint: Timeout (${TIMEOUT}s) - service may be cold-starting or overloaded" ;;
        35) echo "[Cron] Hint: SSL connect error - check TLS/HTTPS configuration" ;;
        *)  echo "[Cron] Hint: See curl man page for exit code ${CURL_EXIT}" ;;
    esac
    exit 1
fi

CRON_DEBUG="${CRON_DEBUG:-false}"

if [ "${HTTP_CODE}" = "200" ] || [ "${HTTP_CODE}" = "202" ]; then
    echo -e "${GREEN}[Cron] ✓ Cron job executed successfully${NC}"
    if [ "${CRON_DEBUG}" = "true" ]; then
        echo "[Cron] Response: ${BODY}"
    else
        echo "[Cron] Response summary: $(echo "${BODY}" | jq -r '.task // "unknown"' 2>/dev/null || echo "parsed")"
    fi
    exit 0
elif [ "${HTTP_CODE}" = "429" ]; then
    echo -e "${YELLOW}[Cron] ⚠ Rate limited, will retry next cycle${NC}"
    if [ "${CRON_DEBUG}" = "true" ]; then
        echo "[Cron] Response: ${BODY}"
    fi
    exit 0
elif [ "${HTTP_CODE}" = "409" ]; then
    echo -e "${YELLOW}[Cron] ⚠ Skipped - another instance is running${NC}"
    if [ "${CRON_DEBUG}" = "true" ]; then
        echo "[Cron] Response: ${BODY}"
    fi
    exit 0
elif [ "${HTTP_CODE}" = "401" ] || [ "${HTTP_CODE}" = "403" ]; then
    echo -e "${RED}[Cron] ✗ Authentication failed${NC}"
    echo "[Cron] Please check CRON_SECRET matches between cron job and web service"
    if [ "${CRON_DEBUG}" = "true" ]; then
        echo "[Cron] Response: ${BODY}"
    fi
    exit 1
elif [ "${HTTP_CODE}" = "503" ]; then
    echo -e "${RED}[Cron] ✗ Service unavailable (CRON_SECRET not configured or app boot error)${NC}"
    if [ "${CRON_DEBUG}" = "true" ]; then
        echo "[Cron] Response: ${BODY}"
    fi
    exit 1
elif [ "${HTTP_CODE}" = "500" ]; then
    echo -e "${RED}[Cron] ✗ Server error during cron execution${NC}"
    echo "[Cron] Check application logs (delivery_health, reconciliation, cleanup, process_conversion, alerts)"
    if [ "${CRON_DEBUG}" = "true" ]; then
        echo "[Cron] Response: ${BODY}"
    fi
    exit 1
else
    echo -e "${RED}[Cron] ✗ Unexpected response code: ${HTTP_CODE}${NC}"
    if [ "${CRON_DEBUG}" = "true" ]; then
        echo "[Cron] Response: ${BODY}"
    fi
    exit 1
fi

