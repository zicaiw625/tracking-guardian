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
import type { UpgradeStatusUI } from "~/utils/deprecation-dates";
import type { RiskItem } from "~/types";
import { useTranslation, Trans } from "react-i18next";

interface ScanAutoTabProps {
    // 使用 loader 返回的 latestScan；在内部再按需要进行安全访问
    latestScan: any;
    isScanning: boolean;
    handleScan: () => void;
    onExportCSV: () => void;
    upgradeStatus: UpgradeStatusUI | null;
    identifiedPlatforms: string[];
    scriptTags: any[];
    deprecationStatus: any;
    planId: string;
    planIdSafe: string;
    riskItems: RiskItem[];
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
    onNavigate?: (url: string) => void;
}

const MAX_VISIBLE_ACTIONS = 5;

export function ScanAutoTab({
    latestScan,
    isScanning,
    handleScan,
    onExportCSV,
    upgradeStatus: _upgradeStatus,
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
    onNavigate,
}: ScanAutoTabProps) {
    const { t } = useTranslation();

    const hasScanData = !!latestScan;
    const showResults = hasScanData && !isScanning;
    const showEmptyState = !hasScanData && !isScanning;

    if (showEmptyState) {
        return (
            <BlockStack gap="500">
                <EnhancedEmptyState
                    icon="🔍"
                    title={t("scan.autoTab.emptyState.title")}
                    description={t("scan.autoTab.emptyState.description")}
                    helpText={t("scan.autoTab.emptyState.helpText")}
                    primaryAction={{
                        content: t("scan.autoTab.startScan"),
                        onAction: handleScan,
                    }}
                    secondaryAction={{
                        content: t("scan.autoTab.emptyState.learnMore"),
                        url: t("scan.autoTab.emptyState.learnMoreUrl"),
                    }}
                />
                
                {migrationProgress && migrationTimeline && (
                    <Card>
                        <BlockStack gap="400">
                            <InlineStack align="space-between" blockAlign="center">
                                <Text as="h2" variant="headingMd">
                                    {t("scan.autoTab.migrationProgress.title")}
                                </Text>
                                <Badge tone={migrationProgress.completionRate === 100 ? "success" : "attention"}>
                                    {`${Math.round(migrationProgress.completionRate)}% ${t("scan.autoTab.migrationProgress.completed")}`}
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
                                            {t("scan.autoTab.migrationProgress.total", { count: migrationProgress.total })}
                                        </Text>
                                        <Text as="span" variant="bodySm" tone="subdued">
                                            {t("scan.autoTab.migrationProgress.stats", { completed: migrationProgress.completed, inProgress: migrationProgress.inProgress, pending: migrationProgress.pending })}
                                        </Text>
                                    </BlockStack>
                                </InlineStack>
                            </BlockStack>
                        </BlockStack>
                    </Card>
                )}

                {scanHistory && scanHistory.length > 0 && (
                    <ScanHistoryTable scanHistory={scanHistory} onStartScan={handleScan} />
                )}
            </BlockStack>
        );
    }

    return (
        <BlockStack gap="500">
            {(showResults || isScanning) && (
                <Box paddingBlockStart="400">
                    <InlineStack align="space-between">
                        {showResults && (
                            <InlineStack gap="200">
                                <Button icon={ExportIcon} onClick={onExportCSV}>
                                    {t("scan.autoTab.exportCSV")}
                                </Button>
                            </InlineStack>
                        )}
                        <InlineStack gap="200">
                            <Button variant="primary" onClick={handleScan} loading={isScanning} icon={SearchIcon}>
                                {isScanning ? t("scan.autoTab.scanning") : t("scan.autoTab.startScan")}
                            </Button>
                        </InlineStack>
                    </InlineStack>
                </Box>
            )}

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

            {showResults && !showEmptyState && (
                <>
                    <ScanSummaryCards
                        latestScan={latestScan}
                        identifiedPlatforms={identifiedPlatforms}
                        scriptTags={scriptTags}
                        deprecationStatus={deprecationStatus}
                        planIdSafe={planIdSafe}
                    />

                    {latestScan.riskScore > 0 && (
                        <MigrationImpactAnalysis
                            latestScan={latestScan}
                            identifiedPlatforms={identifiedPlatforms}
                            scriptTags={scriptTags}
                            monthlyOrders={monthlyOrders}
                            onMonthlyOrdersChange={onMonthlyOrdersChange}
                        />
                    )}

                    {riskItems.length > 0 && (
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text as="h2" variant="headingMd">
                                        {t("scan.riskDetails.title")}
                                    </Text>
                                    <Badge tone="info">{t("common.countItems", { count: riskItems.length })}</Badge>
                                </InlineStack>
                                <Banner tone="info">
                                    <Text as="p" variant="bodySm">
                                        {t("scan.riskDetails.disclaimer")}
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
                                                                        {item.nameKey ? t(item.nameKey, item.nameParams) : item.name}
                                                            </Text>
                                                        </InlineStack>
                                                        {getSeverityBadge(item.severity, t)}
                                                    </InlineStack>
                                                    <Text as="p" tone="subdued">
                                                        {item.descriptionKey ? t(item.descriptionKey, item.descriptionParams) : item.description}
                                                    </Text>
                                                    {(item.details || item.detailsKey) && (
                                                        <Text as="p" variant="bodySm">
                                                            {item.detailsKey ? t(item.detailsKey, item.detailsParams) : item.details}
                                                        </Text>
                                                    )}
                                                    <InlineStack align="space-between" blockAlign="center">
                                                        <InlineStack gap="200">
                                                            {item.platform && (
                                                                <Badge>{getPlatformName(item.platform, t)}</Badge>
                                                            )}
                                                            {(item.impact || item.impactKey) && (
                                                                <Text as="span" variant="bodySm" tone="critical">
                                                                    {t("scan.riskDetails.impact")} {item.impactKey ? t(item.impactKey, item.impactParams) : item.impact}
                                                                </Text>
                                                            )}
                                                        </InlineStack>
                                                        <Button url={`/app/migrate${item.platform ? `?platform=${item.platform}` : ""}`} size="slim" icon={ArrowRightIcon}>
                                                            {t("scan.riskDetails.oneClickMigrate")}
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
                                                    <strong>{t("scan.riskDetails.freeLimit")}</strong>{t("scan.riskDetails.freeLimitDesc", { limit: FREE_AUDIT_LIMIT, count: hiddenCount })}
                                                </Text>
                                                <InlineStack gap="200">
                                                    <Button
                                                        url="/app/billing"
                                                        variant="primary"
                                                        size="slim"
                                                    >
                                                        {t("scan.riskDetails.upgradeUnlock")}
                                                    </Button>
                                                    <Button
                                                        url="/app/migrate"
                                                        size="slim"
                                                    >
                                                        {t("scan.riskDetails.purchaseOnlyFix")}
                                                    </Button>
                                                </InlineStack>
                                            </BlockStack>
                                        </Banner>
                                    )}
                                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                                        <BlockStack gap="300">
                                            <InlineStack align="space-between" blockAlign="center">
                                                <Text as="span" fontWeight="semibold">
                                                    {t("scan.riskDetails.estimatedFixTime")}
                                                </Text>
                                                <Badge tone={estimatedTimeMinutes > 60 ? "warning" : "info"}>
                                                    {estimatedTimeMinutes > 60
                                                        ? `${Math.floor(estimatedTimeMinutes / 60)} ${t("common.hours")} ${estimatedTimeMinutes % 60} ${t("common.minutes")}`
                                                        : `${estimatedTimeMinutes} ${t("common.minutes")}`}
                                                </Badge>
                                            </InlineStack>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                                {t("scan.riskDetails.basedOnRisk")}
                                            </Text>
                                            {isFreePlan && (
                                                <Banner tone="info">
                                                    <Text as="p" variant="bodySm">
                                                        <strong>{t("scan.riskDetails.upgradeMigration")}</strong>{t("scan.riskDetails.upgradeMigrationDesc")}
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

            {migrationActions && migrationActions.length > 0 && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                {t("scan.migrationActionsCard.title")}
                            </Text>
                            <Badge tone="attention">{t("scan.migrationActionsCard.pending", { count: migrationActions.length })}</Badge>
                        </InlineStack>
                        <BlockStack gap="300">
                            {migrationActions.map((action, index) => (
                                <Box key={`${action.type}-${action.platform || 'unknown'}-${action.scriptTagId || action.webPixelGid || index}`} background="bg-surface-secondary" padding="400" borderRadius="200">
                                    <BlockStack gap="300">
                                        <InlineStack align="space-between" blockAlign="start">
                                            <BlockStack gap="100">
                                                <InlineStack gap="200" blockAlign="center">
                                                    <Text as="span" fontWeight="semibold">
                                                        {action.titleKey ? t(action.titleKey, action.titleParams) : action.title}
                                                    </Text>
                                                    <Badge tone={
                                                        action.priority === "high" ? "critical" :
                                                        action.priority === "medium" ? "warning" : "info"
                                                    }>
                                                        {action.priority === "high" ? t("scan.autoTab.upgradeWindow.high") :
                                                         action.priority === "medium" ? t("scan.autoTab.upgradeWindow.medium") : t("scan.autoTab.upgradeWindow.low")}
                                                    </Badge>
                                                </InlineStack>
                                                {action.platform && (
                                                    <Badge>{getPlatformName(action.platform, t)}</Badge>
                                                )}
                                            </BlockStack>
                                            {action.deadline && (
                                                <Badge tone="warning">{`${t("scan.migrationActionsCard.deadline")} ${action.deadline}`}</Badge>
                                            )}
                                        </InlineStack>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            {action.descriptionKey ? t(action.descriptionKey, action.descriptionParams) : action.description}
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
                                                    {t("scan.migrationActionsCard.cleanGuide")}
                                                </Button>
                                            )}
                                            {action.type === "remove_duplicate" && action.webPixelGid && (
                                                <Button
                                                    tone="critical"
                                                    size="slim"
                                                    loading={isDeleting && pendingDelete?.gid === action.webPixelGid}
                                                    onClick={() => onDeleteWebPixel(action.webPixelGid!, action.platform)}
                                                >
                                                    {t("scan.migrationActionsCard.removeDuplicate")}
                                                </Button>
                                            )}
                                            {action.type === "configure_pixel" && action.titleKey === "scan.migrationLogic.upgrade.title" && (
                                                <Button
                                                    size="slim"
                                                    icon={RefreshIcon}
                                                    loading={isUpgrading}
                                                    onClick={onUpgradePixelSettings}
                                                >
                                                    {t("scan.migrationActionsCard.upgradeConfig")}
                                                </Button>
                                            )}
                                            {action.type === "configure_pixel" && action.titleKey !== "scan.migrationLogic.upgrade.title" && (
                                                <Button
                                                    size="slim"
                                                    url="/app/migrate"
                                                    icon={ArrowRightIcon}
                                                >
                                                    {t("scan.migrationActionsCard.configurePixel")}
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

            {auditAssets && Array.isArray(auditAssets) && auditAssets.length > 0 && (
                <AuditAssetsByRisk
                    assets={auditAssets.filter((a): a is NonNullable<typeof a> => a !== null).map((asset: any) => ({
                        ...asset,
                        createdAt: new Date(asset.createdAt),
                        updatedAt: new Date(asset.updatedAt),
                        migratedAt: asset.migratedAt ? new Date(asset.migratedAt) : null,
                    }))}
                    currentPlan={planId === "pro" ? "growth" : planId === "free" || planId === "starter" || planId === "growth" || planId === "agency" ? planId : "free"}
                    freeTierLimit={3}
                    riskScore={latestScan?.riskScore}
                    onAssetClick={(assetId) => {
                        const url = `/app/migrate?asset=${assetId}`;
                        if (onNavigate) { onNavigate(url); } else { window.location.href = url; }
                    }}
                />
            )}

            {migrationProgress && migrationTimeline && (
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                {t("scan.autoTab.migrationProgress.title")}
                            </Text>
                            <Badge tone={migrationProgress.completionRate === 100 ? "success" : "attention"}>
                                {`${Math.round(migrationProgress.completionRate)}% ${t("scan.autoTab.migrationProgress.completed")}`}
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
                                        {t("scan.autoTab.migrationProgress.total", { count: migrationProgress.total })}
                                    </Text>
                                    <Text as="span" variant="bodySm" tone="subdued">
                                        {t("scan.autoTab.migrationProgress.stats", { completed: migrationProgress.completed, inProgress: migrationProgress.inProgress, pending: migrationProgress.pending })}
                                    </Text>
                                </BlockStack>
                                {migrationTimeline.totalEstimatedTime > 0 && (
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={ClockIcon} tone="subdued" />
                                        <Text as="span" variant="bodySm" tone="subdued" fontWeight="semibold">
                                            {t("scan.autoTab.migrationProgress.remainingTime")} {Math.round(migrationTimeline.totalEstimatedTime / 60)} {t("common.hours")} {migrationTimeline.totalEstimatedTime % 60} {t("common.minutes")}
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
                                        {t("scan.autoTab.migrationProgress.nextSteps")}
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
                                                                {item.asset.displayName || item.asset.platform || t("scan.autoTab.migrationProgress.unknownAsset")}
                                                            </Text>
                                                            <Badge tone={(item.asset.priority || item.priority.priority) >= 8 ? "critical" : (item.asset.priority || item.priority.priority) >= 5 ? undefined : "info"}>
                                                                {t("scan.autoTab.migrationProgress.priority", { priority: item.asset.priority || item.priority.priority })}
                                                            </Badge>
                                                            {(item.asset.priority || item.priority.priority) >= 8 && (
                                                                <Badge tone="attention">{t("scan.autoTab.upgradeWindow.high")}</Badge>
                                                            )}
                                                            {(item.asset.priority || item.priority.priority) >= 5 && (item.asset.priority || item.priority.priority) < 8 && (
                                                                <Badge tone="warning">{t("scan.autoTab.upgradeWindow.medium")}</Badge>
                                                            )}
                                                        </InlineStack>
                                                        <InlineStack gap="200" blockAlign="center">
                                                            <Text as="span" variant="bodySm" tone="subdued">
                                                                {item.priority.reasonKey ? t(item.priority.reasonKey, item.priority.reasonParams) : item.priority.reason || t("scan.autoTab.migrationProgress.noReason")}
                                                            </Text>
                                                            {item.asset.estimatedTimeMinutes && (
                                                                <InlineStack gap="100" blockAlign="center">
                                                                    <Icon source={ClockIcon} />
                                                                    <Badge>
                                                                        {`${t("common.estimated")} ${item.asset.estimatedTimeMinutes < 60
                                                                            ? `${item.asset.estimatedTimeMinutes} ${t("common.minutes")}`
                                                                            : `${Math.floor(item.asset.estimatedTimeMinutes / 60)} ${t("common.hours")} ${item.asset.estimatedTimeMinutes % 60} ${t("common.minutes")}`}`}
                                                                    </Badge>
                                                                </InlineStack>
                                                            )}
                                                            {!item.asset.estimatedTimeMinutes && item.priority.estimatedTime && (
                                                                <InlineStack gap="100" blockAlign="center">
                                                                    <Icon source={ClockIcon} />
                                                                    <Badge>
                                                                        {`${t("common.estimated")} ${item.priority.estimatedTime < 60
                                                                            ? `${item.priority.estimatedTime} ${t("common.minutes")}`
                                                                            : `${Math.floor(item.priority.estimatedTime / 60)} ${t("common.hours")} ${item.priority.estimatedTime % 60} ${t("common.minutes")}`}`}
                                                                    </Badge>
                                                                </InlineStack>
                                                            )}
                                                        </InlineStack>
                                                        {item.blockingDependencies.length > 0 && (
                                                            <Banner tone="warning">
                                                                <Text as="p" variant="bodySm">
                                                                    {t("scan.autoTab.migrationProgress.waitingDependencies", { count: item.blockingDependencies.length })}
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
                                                            {t("checklist.startMigration")}
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
                                                            {t("scan.autoTab.migrationProgress.markComplete")}
                                                        </Button>
                                                    </InlineStack>
                                                </InlineStack>
                                            </Box>
                                        ))}
                                    {migrationTimeline.assets.filter((item: any) => item.canStart && item.asset.migrationStatus === "pending").length === 0 && (
                                        <Banner tone="success">
                                            <Text as="p" variant="bodySm">
                                                {t("scan.autoTab.migrationProgress.allReadyCompleted")}
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

            <Card>
                <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                            {t("scan.autoTab.wizard.title")}
                        </Text>
                        <Badge tone="info">{t("scan.autoTab.wizard.badge")}</Badge>
                    </InlineStack>
                    <Text as="p" tone="subdued">
                        {t("scan.autoTab.wizard.description")}
                    </Text>
                    <Divider />
                    <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                            {t("scan.autoTab.wizard.webPixelTitle")}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                            {t("scan.autoTab.wizard.webPixelDesc")}
                        </Text>
                        <InlineStack gap="300" wrap>
                            <Button
                                url={shop?.domain ? getShopifyAdminUrl(shop.domain, "/settings/notifications") : "#"}
                                disabled={!shop?.domain}
                                external
                                icon={ShareIcon}
                            >
                                {t("scan.autoTab.wizard.managePixels")}
                            </Button>
                            <Button
                                url="/app/migrate"
                                icon={ArrowRightIcon}
                            >
                                {t("scan.autoTab.wizard.configureInApp")}
                            </Button>
                        </InlineStack>
                    </BlockStack>
                    <Divider />
                    <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                            {t("scan.autoTab.wizard.checkoutEditorTitle")}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                            {t("scan.autoTab.wizard.checkoutEditorDesc")}
                        </Text>
                        <InlineStack gap="300" wrap>
                            <Button
                                url={shop?.domain ? getShopifyAdminUrl(shop.domain, "/themes/current/editor") : "#"}
                                disabled={!shop?.domain}
                                external
                                icon={ShareIcon}
                            >
                                {t("scan.autoTab.wizard.openEditor")}
                            </Button>
                            <Button
                                url="https://shopify.dev/docs/apps/online-store/checkout-extensibility"
                                external
                                icon={InfoIcon}
                            >
                                {t("scan.autoTab.wizard.viewDocs")}
                            </Button>
                        </InlineStack>
                    </BlockStack>
                    <Divider />
                    <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                            {t("scan.autoTab.wizard.checklistTitle")}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                            {t("scan.autoTab.wizard.checklistDesc")}
                        </Text>
                        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                            <BlockStack gap="200">
                                <Text as="p" fontWeight="semibold">{t("scan.autoTab.wizard.pendingItems")}</Text>
                                <List type="number">
                                    {migrationActions && migrationActions.length > 0 ? (
                                        migrationActions.slice(0, MAX_VISIBLE_ACTIONS).map((action, index) => (
                                            <List.Item key={`${action.type}-${action.platform || 'unknown'}-${action.scriptTagId || action.webPixelGid || 'no-id'}-${index}`}>
                                                {action.titleKey ? t(action.titleKey, action.titleParams) : action.title}
                                                {action.platform && ` (${getPlatformName(action.platform, t)})`}
                                                {action.priority === "high" && " ⚠️"}
                                            </List.Item>
                                        ))
                                    ) : (
                                        <List.Item>{t("scan.autoTab.migrationActions.noPending")}</List.Item>
                                    )}
                                    {migrationActions && migrationActions.length > MAX_VISIBLE_ACTIONS && (
                                        <List.Item>{t("scan.autoTab.migrationActions.moreItems", { count: migrationActions.length - MAX_VISIBLE_ACTIONS })}</List.Item>
                                    )}
                                </List>
                                <InlineStack gap="200" align="end">
                                    <Button
                                        icon={ClipboardIcon}
                                        loading={isCopying}
                                        onClick={onCopyChecklist}
                                    >
                                        {t("scan.autoTab.wizard.copyChecklist")}
                                    </Button>
                                    <Button
                                        icon={ExportIcon}
                                        loading={isExporting}
                                        onClick={onExportChecklist}
                                    >
                                        {t("scan.autoTab.wizard.exportText")}
                                    </Button>
                                </InlineStack>
                            </BlockStack>
                        </Box>
                    </BlockStack>
                    <Divider />
                    <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                            {t("scan.autoTab.wizard.alternativesTitle")}
                        </Text>
                        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                            <BlockStack gap="300">
                                <InlineStack gap="400" wrap>
                                    <Box minWidth="200px">
                                        <BlockStack gap="100">
                                            <Badge tone="success">{t("scan.autoTab.wizard.officialAlternative")}</Badge>
                                            <Text as="p" variant="bodySm">
                                                <Trans i18nKey="scan.autoTab.wizard.officialAlternativeDesc" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                                            </Text>
                                        </BlockStack>
                                    </Box>
                                    <Box minWidth="200px">
                                        <BlockStack gap="100">
                                            <Badge tone="info">{t("scan.autoTab.wizard.webPixelAlternative")}</Badge>
                                            <Text as="p" variant="bodySm">
                                                <Trans i18nKey="scan.autoTab.wizard.webPixelAlternativeDesc" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                                            </Text>
                                        </BlockStack>
                                    </Box>
                                    <Box minWidth="200px">
                                        <BlockStack gap="100">
                                            <Badge tone="warning">{t("scan.autoTab.wizard.pageCustomization")}</Badge>
                                            <Text as="p" variant="bodySm">
                                                <Trans i18nKey="scan.autoTab.wizard.pageCustomizationDesc" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
                                            </Text>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                                <strong>{t("scan.autoTab.wizard.pageCustomizationNote")}</strong>{t("scan.autoTab.wizard.pageCustomizationNoteDesc")}
                                            </Text>
                                        </BlockStack>
                                    </Box>
                                </InlineStack>
                            </BlockStack>
                        </Box>
                    </BlockStack>
                </BlockStack>
            </Card>
                
                </>
            )}

            {scanHistory && scanHistory.length > 0 && (
                <ScanHistoryTable scanHistory={scanHistory} onStartScan={handleScan} />
            )}

            {latestScan && (latestScan.riskScore || 0) > 0 && (
                <Banner title={t("scan.autoTab.suggestMigrationBanner.title")} tone="warning" action={{ content: t("scan.autoTab.suggestMigrationBanner.action"), url: "/app/migrate" }}>
                    <p>
                        {t("scan.autoTab.suggestMigrationBanner.content")}
                    </p>
                </Banner>
            )}
        </BlockStack>
    );
}