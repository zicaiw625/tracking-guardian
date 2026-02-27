#!/bin/bash













set -e


RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'


log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }


FULL_TEST=false
QUICK_TEST=false
COVERAGE=false
CI_MODE=false


while [[ "$#" -gt 0 ]]; do
    case $1 in
        --full) FULL_TEST=true ;;
        --quick) QUICK_TEST=true ;;
        --coverage) COVERAGE=true ;;
        --ci) CI_MODE=true ;;
        *) log_error "未知参数: $1"; exit 1 ;;
    esac
    shift
done


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

log_info "项目根目录: $PROJECT_ROOT"




log_info "检查环境..."


if ! command -v node &> /dev/null; then
    log_error "未找到 Node.js，请先安装"
    exit 1
fi
log_success "Node.js 版本: $(node --version)"


if ! command -v pnpm &> /dev/null; then
    log_error "未找到 pnpm，请先安装: npm install -g pnpm"
    exit 1
fi
log_success "pnpm 版本: $(pnpm --version)"


if [ ! -d "node_modules" ]; then
    log_warn "未找到 node_modules，正在安装依赖..."
    pnpm install --frozen-lockfile
fi




log_info "运行类型检查..."

if pnpm typecheck; then
    log_success "类型检查通过"
else
    log_error "类型检查失败"
    exit 1
fi




log_info "运行 ESLint..."

if pnpm lint; then
    log_success "Linting 通过"
else
    log_error "Linting 失败"
    exit 1
fi




log_info "运行单元测试..."

TEST_CMD="pnpm test"

if [ "$COVERAGE" = true ]; then
    TEST_CMD="$TEST_CMD -- --coverage"
fi

if [ "$CI_MODE" = true ]; then
    TEST_CMD="$TEST_CMD -- --reporter=json --reporter=default"
fi

if [ "$QUICK_TEST" = true ]; then

    log_info "运行快速冒烟测试..."

    $TEST_CMD -- tests/services/billing-gate.test.ts \
                 tests/pixel/consent.test.ts
else

    log_info "运行完整测试套件..."
    $TEST_CMD
fi

if [ $? -eq 0 ]; then
    log_success "单元测试通过"
else
    log_error "单元测试失败"
    exit 1
fi




if [ "$FULL_TEST" = true ] || [ "$QUICK_TEST" = false ]; then
    log_info "运行集成测试..."

    pnpm test -- tests/integration/

    if [ $? -eq 0 ]; then
        log_success "集成测试通过"
    else
        log_error "集成测试失败"
        exit 1
    fi
fi





log_info "运行计费系统测试..."

pnpm test -- tests/services/billing/

if [ $? -eq 0 ]; then
    log_success "计费测试通过"
else
    log_error "计费测试失败"
    exit 1
fi




if [ "$FULL_TEST" = true ]; then
    log_info "运行 Webhook 测试..."

    pnpm test -- tests/webhooks/

    if [ $? -eq 0 ]; then
        log_success "Webhook 测试通过"
    else
        log_error "Webhook 测试失败"
        exit 1
    fi
fi




log_info "测试构建..."

if pnpm build; then
    log_success "构建成功"
else
    log_error "构建失败"
    exit 1
fi




if [ "$FULL_TEST" = true ]; then
    log_info "构建扩展..."

    if pnpm build:extensions; then
        log_success "扩展构建成功"
    else
        log_warn "扩展构建失败（可能是开发环境）"
    fi
fi




if [ "$COVERAGE" = true ]; then
    log_info "生成覆盖率报告..."

    if [ -d "coverage" ]; then
        log_success "覆盖率报告已生成: coverage/index.html"


        COVERAGE_THRESHOLD=70


        if [ -f "coverage/coverage-summary.json" ]; then
            LINES_PCT=$(cat coverage/coverage-summary.json | grep -o '"lines":{"total":[0-9]*,"covered":[0-9]*,"skipped":[0-9]*,"pct":[0-9.]*' | grep -o 'pct":[0-9.]*' | head -1 | cut -d: -f2)

            if [ -n "$LINES_PCT" ]; then
                log_info "行覆盖率: ${LINES_PCT}%"

                if (( $(echo "$LINES_PCT < $COVERAGE_THRESHOLD" | bc -l) )); then
                    log_warn "覆盖率低于 ${COVERAGE_THRESHOLD}%"
                else
                    log_success "覆盖率达标"
                fi
            fi
        fi
    else
        log_warn "未找到覆盖率目录"
    fi
fi




echo ""
echo "============================================================"
log_success "所有测试通过！"
echo "============================================================"
echo ""

if [ "$FULL_TEST" = true ]; then
    echo "已运行: 完整测试套件"
elif [ "$QUICK_TEST" = true ]; then
    echo "已运行: 快速冒烟测试"
else
    echo "已运行: 标准测试套件"
fi

if [ "$COVERAGE" = true ]; then
    echo "覆盖率报告: coverage/index.html"
fi

echo ""
log_info "提示: 使用 --full 运行完整测试，使用 --quick 运行快速测试"

