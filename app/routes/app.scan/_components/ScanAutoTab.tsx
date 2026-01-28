import { BlockStack, Box, Card, Text, InlineStack, Badge, Button, Banner, Divider, List, ProgressBar, Icon } from "@shopify/polaris";
import type { SubmitFunction } from "@remix-run/react";
import { SearchIcon, ExportIcon, AlertCircleIcon, ArrowRightIcon, InfoIcon, RefreshIcon, ClockIcon, ShareIcon, ClipboardIcon } from "~/components/icons";
import { CardSkeleton, EnhancedEmptyState } from "~/components/ui";
import { ScanSummaryCards, ScanHistoryTable, MigrationImpactAnalysis } from "./index";
import { AuditAssetsByRisk } from "~/components/scan/AuditAssetsByRisk";
import { MigrationDependencyGraph } from "~/components/scan/MigrationDependencyGraph";
import { getPlatformName, getSeverityBadge } from "~/components/scan";
import { getShopifyAdminUrl } from "~/utils/helpers";
import type { MigrationAction } from "~/services/scanner/types";

interface ScanAutoTabProps {
    // 使用 loader 返回的 latestScan；在内部再按需要进行安全访问
    latestScan: any;
    isScanning: boolean;
    handleScan: () => void;
    onExportCSV: () => void;
    upgradeStatus: {
        title?: string;
        message?: string;
        urgency?: "critical" | "high" | "medium" | "low" | "resolved";
        autoUpgradeInfo?: {
            autoUpgradeMessage?: string;
            isInAutoUpgradeWindow?: boolean;
        };
        actions?: string[];
    } | null;
    identifiedPlatforms: string[];
    scriptTags: any[];
    deprecationStatus: any;
    planId: string;
    planIdSafe: string;
    riskItems: Array<{ severity: "high" | "medium" | "low"; name: string; description: string; details?: string; platform?: string; impact?: string }>;
    migrationActions: MigrationAction[] | null;
    auditAssets: any[] | null;
    migrationProgress: { completionRate: number; total: number; completed: number; inProgress: number; pending: number } | null;
    migrationTimeline: any | null;
    dependencyGraph: any;
    shop: { id: string; domain: string } | null;
    scanHistory: any[];
    monthlyOrders: number;
    onMonthlyOrdersChange: (value: number) => void;
    onShowScriptTagGuidance: (scriptTagId: number, platform?: string) => void;
    onDeleteWebPixel: (webPixelGid: string, platform?: string) => void;
    onUpgradePixelSettings: () => void;
    isDeleting: boolean;
    pendingDelete: { gid: string; platform?: string } | null;
    isUpgrading: boolean;
    submit: SubmitFunction;
    isCopying: boolean;
    isExporting: boolean;
    onCopyChecklist: () => void;
    onExportChecklist: () => void;
}

const MAX_VISIBLE_ACTIONS = 5;

export function ScanAutoTab({
    latestScan,
    isScanning,
    handleScan,
    onExportCSV,
    upgradeStatus,
    identifiedPlatforms,
    scriptTags,
    deprecationStatus,
    planId,
    planIdSafe,
    riskItems,
    migrationActions,
    auditAssets,
    migrationProgress,
    migrationTimeline,
    dependencyGraph,
    shop,
    scanHistory,
    monthlyOrders,
    onMonthlyOrdersChange,
    onShowScriptTagGuidance,
    onDeleteWebPixel,
    onUpgradePixelSettings,
    isDeleting,
    pendingDelete,
    isUpgrading,
    submit,
    isCopying,
    isExporting,
    onCopyChecklist,
    onExportChecklist,
}: ScanAutoTabProps) {
    return (
        <BlockStack gap="500">
            <Box paddingBlockStart="400">
                <InlineStack align="space-between">
                    {latestScan && (
                        <InlineStack gap="200">
                            <Button icon={ExportIcon} onClick={onExportCSV}>
                                导出扫描报告 CSV
                            </Button>
                        </InlineStack>
                    )}
                    <InlineStack gap="200">
                        <Button variant="primary" onClick={handleScan} loading={isScanning} icon={SearchIcon}>
                            {isScanning ? "扫描中..." : "开始扫描"}
                        </Button>
                    </InlineStack>
                </InlineStack>
            </Box>
            {isScanning && (
                <Card>
                    <BlockStack gap="400">
                        <CardSkeleton lines={4} showTitle={true} />
                        <Box paddingBlockStart="200">
                            <ProgressBar progress={75} tone="primary"/>
                        </Box>
                    </BlockStack>
                </Card>
            )}
            {!latestScan && !isScanning && (
                <EnhancedEmptyState
                    icon="🔍"
                    title="还没有扫描报告"
                    description="点击开始扫描，我们会自动检测 ScriptTags 和已安装的像素配置，并给出风险等级与迁移建议。预计耗时约 10 秒，不会修改任何设置。"
                    helpText="关于 Additional Scripts：Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts。请切换到「手动分析」标签页，粘贴脚本内容进行分析。"
                    primaryAction={{
                        content: "开始扫描",
                        onAction: handleScan,
                    }}
                    secondaryAction={{
                        content: "了解更多",
                        url: "https://help.shopify.com/en/manual/pixels/web-pixels",
                    }}
                />
            )}
            {latestScan && !isScanning && upgradeStatus && upgradeStatus.title && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                Shopify 升级风险窗口
                            </Text>
                            <Badge tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"}>
                                {upgradeStatus.urgency === "critical" ? "紧急" : upgradeStatus.urgency === "high" ? "高优先级" : upgradeStatus.urgency === "medium" ? "中优先级" : "低优先级"}
                            </Badge>
                        </InlineStack>
                        <Divider />
                        <Banner tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"} title={upgradeStatus.title}>
                            <BlockStack gap="200">
                                <Text as="p">{upgradeStatus.message}</Text>
                                {upgradeStatus.autoUpgradeInfo && upgradeStatus.autoUpgradeInfo.autoUpgradeMessage && (
                                    <Banner tone={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "critical" : "warning"} title={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "⚡ 自动升级窗口已开始" : "⚠️ 自动升级风险窗口"}>
                                        <Text as="p">{upgradeStatus.autoUpgradeInfo.autoUpgradeMessage}</Text>
                                    </Banner>
                                )}
                                {upgradeStatus.actions && upgradeStatus.actions.length > 0 && (
                                    <BlockStack gap="100">
                                        <Text as="p" fontWeight="semibold">建议操作：</Text>
                                        <List>
                                            {upgradeStatus.actions.map((action, idx) => (
                                                <List.Item key={idx}>{action}</List.Item>
                                            ))}
                                        </List>
                                    </BlockStack>
                                )}
                            </BlockStack>
                        </Banner>
                    </BlockStack>
                </Card>
            )}
            {latestScan && !isScanning && (
                <ScanSummaryCards
                    latestScan={latestScan}
                    identifiedPlatforms={identifiedPlatforms}
                    scriptTags={scriptTags}
                    deprecationStatus={deprecationStatus}
                    planIdSafe={planIdSafe}
                />
            )}
            {latestScan && !isScanning && latestScan.riskScore && latestScan.riskScore > 0 && (
                <MigrationImpactAnalysis
                    latestScan={latestScan}
                    identifiedPlatforms={identifiedPlatforms}
                    scriptTags={scriptTags}
                    monthlyOrders={monthlyOrders}
                    onMonthlyOrdersChange={onMonthlyOrdersChange}
                />
            )}
            {latestScan && riskItems.length > 0 && !isScanning && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                风险详情
                            </Text>
                            <Badge tone="info">{`${riskItems.length} 项`}</Badge>
                        </InlineStack>
                        <Banner tone="info">
                            <Text as="p" variant="bodySm">
                                风险识别基于脚本 URL 和已知平台指纹推断，并非实际脚本内容分析。如需更精确的检测，请在「脚本内容分析」中粘贴实际脚本代码。
                            </Text>
                        </Banner>
                        {(() => {
                            const isFreePlan = planId === "free";
                            const FREE_AUDIT_LIMIT = 3;
                            const highRiskItems = riskItems.filter(item => item.severity === "high");
                            const displayedItems = isFreePlan
                                ? highRiskItems.slice(0, FREE_AUDIT_LIMIT)
                                : riskItems;
                            const hiddenCount = isFreePlan
                                ? Math.max(0, riskItems.length - FREE_AUDIT_LIMIT)
                                : 0;
                            const estimatedTimeMinutes = riskItems.reduce((sum, item) => {
                                const timeMap = { high: 30, medium: 15, low: 5 };
                                return sum + (timeMap[item.severity] || 10);
                            }, 0);
                            return (
                                <>
                                    <BlockStack gap="300">
                                        {displayedItems.map((item, index) => (
                                            <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                                                <BlockStack gap="300">
                                                    <InlineStack align="space-between">
                                                        <InlineStack gap="200">
                                                            <Icon source={AlertCircleIcon} tone={item.severity === "high"
                                                                ? "critical"
                                                                : item.severity === "medium"
                                                                    ? "warning"
                                                                    : "info"}/>
                                                            <Text as="span" fontWeight="semibold">
                                                                {item.name}
                                                            </Text>
                                                        </InlineStack>
                                                        {getSeverityBadge(item.severity)}
                                                    </InlineStack>
                                                    <Text as="p" tone="subdued">
                                                        {item.description}
                                                    </Text>
                                                    {item.details && (
                                                        <Text as="p" variant="bodySm">
                                                            {item.details}
                                                        </Text>
                                                    )}
                                                    <InlineStack align="space-between" blockAlign="center">
                                                        <InlineStack gap="200">
                                                            {item.platform && (
                                                                <Badge>{getPlatformName(item.platform)}</Badge>
                                                            )}
                                                            {item.impact && (
                                                                <Text as="span" variant="bodySm" tone="critical">
                                                                    影响: {item.impact}
                                                                </Text>
                                                            )}
                                                        </InlineStack>
                                                        <Button url={`/app/migrate${item.platform ? `?platform=${item.platform}` : ""}`} size="slim" icon={ArrowRightIcon}>
                                                            一键迁移
                                                        </Button>
                                                    </InlineStack>
                                                </BlockStack>
                                            </Box>
                                        ))}
                                    </BlockStack>
                                    {isFreePlan && hiddenCount > 0 && (
                                        <Banner tone="warning">
                                            <BlockStack gap="200">
                                                <Text as="p" variant="bodySm">
                                                    <strong>免费版限制：</strong>仅显示前 {FREE_AUDIT_LIMIT} 条高风险项，还有 {hiddenCount} 项未显示。
                                                </Text>
                                                <InlineStack gap="200">
                                                    <Button
                                                        url="/app/billing"
                                                        variant="primary"
                                                        size="slim"
                                                    >
                                                        升级解锁完整报告
                                                    </Button>
                                                    <Button
                                                        url="/app/migrate"
                                                        size="slim"
                                                    >
                                                        启用 Purchase-only 修复（10 分钟）
                                                    </Button>
                                                </InlineStack>
                                            </BlockStack>
                                        </Banner>
                                    )}
                                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                                        <BlockStack gap="300">
                                            <InlineStack align="space-between" blockAlign="center">
                                                <Text as="span" fontWeight="semibold">
                                                    预计修复时间
                                                </Text>
                                                <Badge tone={estimatedTimeMinutes > 60 ? "warning" : "info"}>
                                                    {estimatedTimeMinutes > 60
                                                        ? `${Math.floor(estimatedTimeMinutes / 60)} 小时 ${estimatedTimeMinutes % 60} 分钟`
                                                        : `${estimatedTimeMinutes} 分钟`}
                                                </Badge>
                                            </InlineStack>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                                基于当前风险项数量和严重程度估算
                                            </Text>
                                            {isFreePlan && (
                                                <Banner tone="info">
                                                    <Text as="p" variant="bodySm">
                                                        <strong>升级到 Migration 版</strong>可启用 Full-funnel 修复（30 分钟，Growth 套餐），获得完整迁移清单和验收报告。
                                                    </Text>
                                                </Banner>
                                            )}
                                        </BlockStack>
                                    </Box>
                                </>
                            );
                        })()}
                    </BlockStack>
                </Card>
            )}
            {latestScan && migrationActions && migrationActions.length > 0 && !isScanning && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                迁移操作
                            </Text>
                            <Badge tone="attention">{`${migrationActions.length} 项待处理`}</Badge>
                        </InlineStack>
                        <BlockStack gap="300">
                            {migrationActions.map((action, index) => (
                                <Box key={`${action.type}-${action.platform || 'unknown'}-${action.scriptTagId || action.webPixelGid || index}`} background="bg-surface-secondary" padding="400" borderRadius="200">
                                    <BlockStack gap="300">
                                        <InlineStack align="space-between" blockAlign="start">
                                            <BlockStack gap="100">
                                                <InlineStack gap="200" blockAlign="center">
                                                    <Text as="span" fontWeight="semibold">
                                                        {action.title}
                                                    </Text>
                                                    <Badge tone={
                                                        action.priority === "high" ? "critical" :
                                                        action.priority === "medium" ? "warning" : "info"
                                                    }>
                                                        {action.priority === "high" ? "高优先级" :
                                                         action.priority === "medium" ? "中优先级" : "低优先级"}
                                                    </Badge>
                                                </InlineStack>
                                                {action.platform && (
                                                    <Badge>{getPlatformName(action.platform)}</Badge>
                                                )}
                                            </BlockStack>
                                            {action.deadline && (
                                                <Badge tone="warning">{`截止: ${action.deadline}`}</Badge>
                                            )}
                                        </InlineStack>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            {action.description}
                                        </Text>
                                        <InlineStack gap="200" align="end">
                                            {action.type === "migrate_script_tag" && action.scriptTagId && (
                                                <Button
                                                    size="slim"
                                                    icon={InfoIcon}
                                                    onClick={() => onShowScriptTagGuidance(
                                                        action.scriptTagId!,
                                                        action.platform
                                                    )}
                                                >
                                                    查看清理指南
                                                </Button>
                                            )}
                                            {action.type === "remove_duplicate" && action.webPixelGid && (
                                                <Button
                                                    tone="critical"
                                                    size="slim"
                                                    loading={isDeleting && pendingDelete?.gid === action.webPixelGid}
                                                    onClick={() => onDeleteWebPixel(action.webPixelGid!, action.platform)}
                                                >
                                                    删除重复像素
                                                </Button>
                                            )}
                                            {action.type === "configure_pixel" && action.description?.includes("升级") && (
                                                <Button
                                                    size="slim"
                                                    icon={RefreshIcon}
                                                    loading={isUpgrading}
                                                    onClick={onUpgradePixelSettings}
                                                >
                                                    升级配置
                                                </Button>
                                            )}
                                            {action.type === "configure_pixel" && !action.description?.includes("升级") && (
                                                <Button
                                                    size="slim"
                                                    url="/app/migrate"
                                                    icon={ArrowRightIcon}
                                                >
                                                    配置 Pixel
                                                </Button>
                                            )}
                                        </InlineStack>
                                    </BlockStack>
                                </Box>
                            ))}
                        </BlockStack>
                    </BlockStack>
                </Card>
            )}
            {latestScan && auditAssets && Array.isArray(auditAssets) && auditAssets.length > 0 && !isScanning && (
                <AuditAssetsByRisk
                    assets={auditAssets.filter((a): a is NonNullable<typeof a> => a !== null).map((asset: any) => ({
                        ...asset,
                        createdAt: new Date(asset.createdAt),
                        updatedAt: new Date(asset.updatedAt),
                        migratedAt: asset.migratedAt ? new Date(asset.migratedAt) : null,
                    }))}
                    currentPlan={planId === "pro" ? "growth" : planId === "free" || planId === "starter" || planId === "growth" || planId === "agency" ? planId : "free"}
                    freeTierLimit={3}
                    onAssetClick={(assetId) => {
                        window.location.href = `/app/migrate?asset=${assetId}`;
                    }}
                />
            )}
            {migrationProgress && migrationTimeline && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                📊 迁移进度
                            </Text>
                            <Badge tone={migrationProgress.completionRate === 100 ? "success" : "attention"}>
                                {`${Math.round(migrationProgress.completionRate)}% 完成`}
                            </Badge>
                        </InlineStack>
                        <BlockStack gap="300">
                            <ProgressBar
                                progress={migrationProgress.completionRate}
                                tone={migrationProgress.completionRate === 100 ? "success" : "primary"}
                                size="medium"
                            />
                            <InlineStack gap="400" align="space-between" wrap>
                                <BlockStack gap="100">
                                    <Text as="span" variant="bodySm" tone="subdued">
                                        总计: {migrationProgress.total} 项
                                    </Text>
                                    <Text as="span" variant="bodySm" tone="subdued">
                                        已完成: {migrationProgress.completed} | 进行中: {migrationProgress.inProgress} | 待处理: {migrationProgress.pending}
                                    </Text>
                                </BlockStack>
                                {migrationTimeline.totalEstimatedTime > 0 && (
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={ClockIcon} tone="subdued" />
                                        <Text as="span" variant="bodySm" tone="subdued" fontWeight="semibold">
                                            预计剩余时间: {Math.round(migrationTimeline.totalEstimatedTime / 60)} 小时 {migrationTimeline.totalEstimatedTime % 60} 分钟
                                        </Text>
                                    </InlineStack>
                                )}
                            </InlineStack>
                        </BlockStack>
                        {migrationTimeline.assets.length > 0 && (
                            <>
                                <Divider />
                                <BlockStack gap="300">
                                    <Text as="h3" variant="headingSm">
                                        下一步建议
                                    </Text>
                                {migrationTimeline.assets
                                        .filter((item: any) => item.canStart && item.asset.migrationStatus === "pending")
                                        .slice(0, 3)
                                        .map((item: any) => (
                                            <Box key={item.asset.id} background="bg-surface-secondary" padding="300" borderRadius="200">
                                                <InlineStack align="space-between" blockAlign="center">
                                                    <BlockStack gap="100">
                                                        <InlineStack gap="200" blockAlign="center">
                                                            <Text as="span" fontWeight="semibold">
                                                                {item.asset.displayName || item.asset.platform || "未知资产"}
                                                            </Text>
                                                            <Badge tone={(item.asset.priority || item.priority.priority) >= 8 ? "critical" : (item.asset.priority || item.priority.priority) >= 5 ? undefined : "info"}>
                                                                {`优先级 ${item.asset.priority || item.priority.priority}/10`}
                                                            </Badge>
                                                            {(item.asset.priority || item.priority.priority) >= 8 && (
                                                                <Badge tone="attention">高优先级</Badge>
                                                            )}
                                                            {(item.asset.priority || item.priority.priority) >= 5 && (item.asset.priority || item.priority.priority) < 8 && (
                                                                <Badge tone="warning">中优先级</Badge>
                                                            )}
                                                        </InlineStack>
                                                        <InlineStack gap="200" blockAlign="center">
                                                            <Text as="span" variant="bodySm" tone="subdued">
                                                                {item.priority.reason || "无说明"}
                                                            </Text>
                                                            {item.asset.estimatedTimeMinutes && (
                                                                <InlineStack gap="100" blockAlign="center">
                                                                    <Icon source={ClockIcon} />
                                                                    <Badge>
                                                                        {`预计 ${item.asset.estimatedTimeMinutes < 60
                                                                            ? `${item.asset.estimatedTimeMinutes} 分钟`
                                                                            : `${Math.floor(item.asset.estimatedTimeMinutes / 60)} 小时 ${item.asset.estimatedTimeMinutes % 60} 分钟`}`}
                                                                    </Badge>
                                                                </InlineStack>
                                                            )}
                                                            {!item.asset.estimatedTimeMinutes && item.priority.estimatedTime && (
                                                                <InlineStack gap="100" blockAlign="center">
                                                                    <Icon source={ClockIcon} />
                                                                    <Badge>
                                                                        {`预计 ${item.priority.estimatedTime < 60
                                                                            ? `${item.priority.estimatedTime} 分钟`
                                                                            : `${Math.floor(item.priority.estimatedTime / 60)} 小时 ${item.priority.estimatedTime % 60} 分钟`}`}
                                                                    </Badge>
                                                                </InlineStack>
                                                            )}
                                                        </InlineStack>
                                                        {item.blockingDependencies.length > 0 && (
                                                            <Banner tone="warning">
                                                                <Text as="p" variant="bodySm">
                                                                    等待 {item.blockingDependencies.length} 个依赖项完成
                                                                </Text>
                                                            </Banner>
                                                        )}
                                                    </BlockStack>
                                                    <InlineStack gap="200">
                                                        <Button
                                                            size="slim"
                                                            url={`/app/migrate?asset=${item.asset.id}`}
                                                            disabled={!item.canStart}
                                                        >
                                                            开始迁移
                                                        </Button>
                                                        <Button
                                                            size="slim"
                                                            variant="plain"
                                                            onClick={() => {
                                                                const formData = new FormData();
                                                                formData.append("_action", "mark_asset_complete");
                                                                formData.append("assetId", item.asset.id);
                                                                submit(formData, { method: "post" });
                                                            }}
                                                        >
                                                            标记完成
                                                        </Button>
                                                    </InlineStack>
                                                </InlineStack>
                                            </Box>
                                        ))}
                                    {migrationTimeline.assets.filter((item: any) => item.canStart && item.asset.migrationStatus === "pending").length === 0 && (
                                        <Banner tone="success">
                                            <Text as="p" variant="bodySm">
                                                所有可立即开始的迁移任务已完成！请检查是否有依赖项需要先完成。
                                            </Text>
                                        </Banner>
                                    )}
                                </BlockStack>
                                {dependencyGraph && (
                                    <>
                                        <Divider />
                                        <MigrationDependencyGraph dependencyGraph={dependencyGraph} />
                                    </>
                                )}
                            </>
                        )}
                    </BlockStack>
                </Card>
            )}
            {latestScan && !isScanning && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                🧭 迁移向导
                            </Text>
                            <Badge tone="info">P1-3 迁移闭环</Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued">
                            根据扫描结果，以下是完成迁移所需的步骤。点击各项可直接跳转到对应位置。
                        </Text>
                        <Divider />
                        <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                                📦 Web Pixel 设置
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                                Web Pixel 是 Shopify 推荐的客户端追踪方式，替代传统 ScriptTag。
                            </Text>
                            <InlineStack gap="300" wrap>
                                <Button
                                    url={shop?.domain ? getShopifyAdminUrl(shop.domain, "/settings/notifications") : "#"}
                                    disabled={!shop?.domain}
                                    external
                                    icon={ShareIcon}
                                >
                                    管理 Pixels（Shopify 后台）
                                </Button>
                                <Button
                                    url="/app/migrate"
                                    icon={ArrowRightIcon}
                                >
                                    在应用内配置 Pixel
                                </Button>
                            </InlineStack>
                        </BlockStack>
                        <Divider />
                        <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                                🛒 Checkout Editor（参考）
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                                如果您已启用新的 Thank you / Order status 体验，请使用 Shopify 官方编辑器完成页面侧自定义（本应用不提供页面模块库）。
                            </Text>
                            <InlineStack gap="300" wrap>
                                <Button
                                    url={shop?.domain ? getShopifyAdminUrl(shop.domain, "/themes/current/editor") : "#"}
                                    disabled={!shop?.domain}
                                    external
                                    icon={ShareIcon}
                                >
                                    打开 Checkout Editor
                                </Button>
                                <Button
                                    url="https://shopify.dev/docs/apps/online-store/checkout-extensibility"
                                    external
                                    icon={InfoIcon}
                                >
                                    查看官方文档
                                </Button>
                            </InlineStack>
                        </BlockStack>
                        <Divider />
                        <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                                📋 迁移清单
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                                生成可导出的迁移步骤清单，方便团队协作或记录进度。
                            </Text>
                            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                                <BlockStack gap="200">
                                    <Text as="p" fontWeight="semibold">待迁移项目：</Text>
                                    <List type="number">
                                        {migrationActions && migrationActions.length > 0 ? (
                                            migrationActions.slice(0, MAX_VISIBLE_ACTIONS).map((action) => (
                                                <List.Item key={`${action.type}-${action.platform || 'unknown'}-${action.scriptTagId || action.webPixelGid || 'no-id'}`}>
                                                    {action.title}
                                                    {action.platform && ` (${getPlatformName(action.platform)})`}
                                                    {action.priority === "high" && " ⚠️"}
                                                </List.Item>
                                            ))
                                        ) : (
                                            <List.Item>暂无待处理项目 ✅</List.Item>
                                        )}
                                        {migrationActions && migrationActions.length > MAX_VISIBLE_ACTIONS && (
                                            <List.Item>...还有 {migrationActions.length - MAX_VISIBLE_ACTIONS} 项</List.Item>
                                        )}
                                    </List>
                                    <InlineStack gap="200" align="end">
                                        <Button
                                            icon={ClipboardIcon}
                                            loading={isCopying}
                                            onClick={onCopyChecklist}
                                        >
                                            复制清单
                                        </Button>
                                        <Button
                                            icon={ExportIcon}
                                            loading={isExporting}
                                            onClick={onExportChecklist}
                                        >
                                            导出文本
                                        </Button>
                                    </InlineStack>
                                </BlockStack>
                            </Box>
                        </BlockStack>
                        <Divider />
                        <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                                🔄 替代方案一览
                            </Text>
                            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                                <BlockStack gap="300">
                                    <InlineStack gap="400" wrap>
                                        <Box minWidth="200px">
                                            <BlockStack gap="100">
                                                <Badge tone="success">官方替代</Badge>
                                                <Text as="p" variant="bodySm">
                                                    • Shopify Pixels（客户端）
                                                    <br />• Customer Events API
                                                </Text>
                                            </BlockStack>
                                        </Box>
                                        <Box minWidth="200px">
                                            <BlockStack gap="100">
                                                <Badge tone="info">Web Pixel 替代</Badge>
                                                <Text as="p" variant="bodySm">
                                                    • ScriptTag → Web Pixel
                                                    <br />• checkout.liquid → Web Pixel
                                                </Text>
                                            </BlockStack>
                                        </Box>
                                        <Box minWidth="200px">
                                            <BlockStack gap="100">
                                                <Badge tone="warning">页面侧自定义</Badge>
                                                <Text as="p" variant="bodySm">
                                                    • Additional Scripts：需人工梳理并在新体验下重做
                                                    <br />• Thank you/Order status 自定义逻辑：以 Shopify 官方能力为准
                                                </Text>
                                                <Text as="p" variant="bodySm" tone="subdued">
                                                    <strong>说明：</strong>当前版本不提供 Survey/Help/Reorder 等页面模块库，页面侧功能请按 Shopify 官方能力与审核要求实施。
                                                </Text>
                                            </BlockStack>
                                        </Box>
                                    </InlineStack>
                                </BlockStack>
                            </Box>
                        </BlockStack>
                    </BlockStack>
                </Card>
            )}
            <ScanHistoryTable scanHistory={scanHistory} onStartScan={handleScan} />
            {latestScan && latestScan.riskScore && latestScan.riskScore > 0 && (
                <Banner title="建议进行迁移" tone="warning" action={{ content: "前往迁移工具", url: "/app/migrate" }}>
                    <p>
                        检测到您的店铺存在需要迁移的追踪脚本。
                        建议使用我们的迁移工具将追踪代码更新为 Shopify Web Pixel 格式。
                    </p>
                </Banner>
            )}
        </BlockStack>
    );
}
