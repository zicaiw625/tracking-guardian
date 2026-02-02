import {
  Box,
  BlockStack,
  InlineStack,
  Card,
  Text,
  Badge,
  Button,
  Banner,
  List,
  Divider,
  ProgressBar,
  Icon,
} from "@shopify/polaris";
import { SearchIcon, ArrowRightIcon, RefreshIcon, InfoIcon, ClockIcon, AlertCircleIcon } from "~/components/icons";
import { CardSkeleton, EnhancedEmptyState } from "~/components/ui";
import { getPlatformName, getSeverityBadge } from "~/components/scan";
import { MigrationDependencyGraph } from "~/components/scan/MigrationDependencyGraph";
import { AuditAssetsByRisk } from "~/components/scan/AuditAssetsByRisk";
import { ScanSummaryCards } from "./ScanSummaryCards";
import { MigrationImpactAnalysis } from "./MigrationImpactAnalysis";
import type { MigrationTimeline } from "~/services/migration-priority.server";
import type { AuditAssetRecord } from "~/services/audit-asset.server";
import type { DependencyGraph } from "~/services/dependency-analysis.server";
import { useTranslation } from "react-i18next";

interface RiskItemLike {
  name: string;
  description: string;
  details?: string;
  severity: string;
  platform?: string;
  impact?: string;
}

interface MigrationActionLike {
  type: string;
  title: string;
  description?: string;
  descriptionKey?: string;
  descriptionParams?: Record<string, any>;
  priority?: string;
  platform?: string;
  scriptTagId?: number;
  webPixelGid?: string;
  deadline?: string;
}

export interface ScanPageBelowTabsContentProps {
  latestScan: { id: string; riskScore?: number } | null;
  isScanning: boolean;
  handleScan: () => void;
  showError: (msg: string) => void;
  showSuccess: (msg: string) => void;
  upgradeStatus: { title?: string; message?: string; urgency?: string; actions?: string[]; autoUpgradeInfo?: { isInAutoUpgradeWindow?: boolean; autoUpgradeMessage?: string } } | null;
  identifiedPlatforms: string[];
  scriptTags: unknown[];
  deprecationStatus: unknown;
  planId: string | null;
  planIdSafe: string;
  riskItems: RiskItemLike[];
  migrationActions: MigrationActionLike[];
  handleShowScriptTagGuidance: (scriptTagId: number, platform?: string) => void;
  handleDeleteWebPixel: (webPixelGid: string, platform?: string) => void;
  handleUpgradePixelSettings: () => void;
  isDeleting: boolean;
  pendingDelete: { gid: string } | null;
  isUpgrading: boolean;
  submit: (data: FormData, options: { method: "get" | "post" }) => void;
  monthlyOrders: number;
  setMonthlyOrders: (n: number) => void;
  auditAssets: unknown[] | null;
  migrationProgress: { completionRate: number; total: number; completed: number; inProgress: number; pending: number } | null;
  migrationTimeline: MigrationTimeline | null;
  dependencyGraph: { nodes?: unknown[]; edges?: unknown[] } | null;
  _shop: { id: string } | null;
}

export function ScanPageBelowTabsContent({
  latestScan,
  isScanning,
  handleScan,
  showError: _showError,
  showSuccess: _showSuccess,
  upgradeStatus,
  identifiedPlatforms,
  scriptTags,
  deprecationStatus,
  planId,
  planIdSafe,
  riskItems,
  migrationActions,
  handleShowScriptTagGuidance,
  handleDeleteWebPixel,
  handleUpgradePixelSettings,
  isDeleting,
  pendingDelete,
  isUpgrading,
  submit,
  monthlyOrders,
  setMonthlyOrders,
  auditAssets,
  migrationProgress,
  migrationTimeline,
  dependencyGraph,
  _shop,
}: ScanPageBelowTabsContentProps) {
  const { t } = useTranslation();

  return (
    <Box paddingBlockStart="400">
      <InlineStack align="space-between">
        {latestScan && (
          <InlineStack gap="200">
          </InlineStack>
        )}
        <InlineStack gap="200">
          <Button variant="primary" onClick={handleScan} loading={isScanning} icon={SearchIcon}>
            {isScanning ? t("scan.autoTab.scanning") : t("scan.autoTab.startScan")}
          </Button>
        </InlineStack>
      </InlineStack>
      {isScanning && (
        <Card>
          <BlockStack gap="400">
            <CardSkeleton lines={4} showTitle={true} />
            <Box paddingBlockStart="200">
              <ProgressBar progress={75} tone="primary" />
            </Box>
          </BlockStack>
        </Card>
      )}
      {!latestScan && !isScanning && (
        <EnhancedEmptyState
          icon="🔍"
          title={t("scan.autoTab.emptyState.title")}
          description={t("scan.autoTab.emptyState.description")}
          helpText={t("scan.autoTab.emptyState.helpText")}
          primaryAction={{ content: t("scan.autoTab.startScan"), onAction: handleScan }}
          secondaryAction={{ content: t("scan.autoTab.emptyState.learnMore"), url: t("scan.autoTab.emptyState.learnMoreUrl") }}
        />
      )}
      {latestScan && !isScanning && upgradeStatus?.title && upgradeStatus?.message && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{t("scan.autoTab.upgradeWindow.title")}</Text>
              <Badge tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"}>
                {upgradeStatus.urgency === "critical" ? t("scan.autoTab.upgradeWindow.critical") : upgradeStatus.urgency === "high" ? t("scan.autoTab.upgradeWindow.high") : upgradeStatus.urgency === "medium" ? t("scan.autoTab.upgradeWindow.medium") : t("scan.autoTab.upgradeWindow.low")}
              </Badge>
            </InlineStack>
            <Divider />
            <Banner tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"} title={upgradeStatus.title}>
              <BlockStack gap="200">
                <Text as="p">{upgradeStatus.message}</Text>
                {upgradeStatus.autoUpgradeInfo?.autoUpgradeMessage && (
                  <Banner tone={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "critical" : "warning"} title={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? t("scan.autoTab.upgradeWindow.autoUpgradeStarted") : t("scan.autoTab.upgradeWindow.autoUpgradeRisk")}>
                    <Text as="p">{upgradeStatus.autoUpgradeInfo.autoUpgradeMessage}</Text>
                  </Banner>
                )}
                {upgradeStatus.actions && upgradeStatus.actions.length > 0 && (
                  <BlockStack gap="100">
                    <Text as="p" fontWeight="semibold">{t("scan.autoTab.upgradeWindow.suggestedActions")}</Text>
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
          latestScan={latestScan as unknown as { riskScore: number; createdAt: unknown; riskItems?: unknown }}
          identifiedPlatforms={identifiedPlatforms}
          scriptTags={scriptTags as Array<{ id: number }>}
          deprecationStatus={deprecationStatus as { scriptTag?: { isExpired: boolean; badge: { text: string }; description: string } } | null | undefined}
          planIdSafe={planIdSafe}
        />
      )}
      {latestScan && !isScanning && (latestScan as { riskScore?: number }).riskScore != null && (latestScan as { riskScore?: number }).riskScore! > 0 && (
        <MigrationImpactAnalysis
          latestScan={latestScan as { riskScore: number }}
          identifiedPlatforms={identifiedPlatforms}
          scriptTags={scriptTags as Array<{ id: number }>}
          monthlyOrders={monthlyOrders}
          onMonthlyOrdersChange={setMonthlyOrders}
        />
      )}
      {latestScan && riskItems.length > 0 && !isScanning && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{t("scan.riskDetails.title")}</Text>
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
              const highRiskItems = riskItems.filter((item) => item.severity === "high");
              const displayedItems = isFreePlan ? highRiskItems.slice(0, FREE_AUDIT_LIMIT) : riskItems;
              const hiddenCount = isFreePlan ? Math.max(0, riskItems.length - FREE_AUDIT_LIMIT) : 0;
              const estimatedTimeMinutes = riskItems.reduce((sum, item) => {
                const timeMap: Record<string, number> = { high: 30, medium: 15, low: 5 };
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
                              <Icon source={AlertCircleIcon} tone={item.severity === "high" ? "critical" : item.severity === "medium" ? "warning" : "info"} />
                              <Text as="span" fontWeight="semibold">{item.name}</Text>
                            </InlineStack>
                            {getSeverityBadge(item.severity, t)}
                          </InlineStack>
                          <Text as="p" tone="subdued">{item.description}</Text>
                          {item.details && <Text as="p" variant="bodySm">{item.details}</Text>}
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200">
                              {item.platform && <Badge>{getPlatformName(item.platform, t)}</Badge>}
                              {item.impact && <Text as="span" variant="bodySm" tone="critical">{t("scan.riskDetails.impact")} {item.impact}</Text>}
                            </InlineStack>
                            <Button url={`/app/migrate${item.platform ? `?platform=${item.platform}` : ""}`} size="slim" icon={ArrowRightIcon}>{t("scan.riskDetails.oneClickMigrate")}</Button>
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
                          <Button url="/app/billing" variant="primary" size="slim">{t("scan.riskDetails.upgradeUnlock")}</Button>
                          <Button url="/app/migrate" size="slim">{t("scan.riskDetails.purchaseOnlyFix")}</Button>
                        </InlineStack>
                      </BlockStack>
                    </Banner>
                  )}
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" fontWeight="semibold">{t("scan.riskDetails.estimatedFixTime")}</Text>
                        <Badge tone={estimatedTimeMinutes > 60 ? "warning" : "info"}>
                          {estimatedTimeMinutes > 60 ? t("common.time.hoursMinutes", { hours: Math.floor(estimatedTimeMinutes / 60), minutes: estimatedTimeMinutes % 60 }) : t("common.time.minutes", { count: estimatedTimeMinutes })}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">{t("scan.riskDetails.basedOnRisk")}</Text>
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
      {latestScan && migrationActions.length > 0 && !isScanning && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{t("scan.migrationActionsCard.title")}</Text>
              <Badge tone="attention">{t("scan.migrationActionsCard.pending", { count: migrationActions.length })}</Badge>
            </InlineStack>
            <BlockStack gap="300">
              {migrationActions.map((action, index) => (
                <Box key={`${action.type}-${action.platform ?? "unknown"}-${action.scriptTagId ?? action.webPixelGid ?? index}`} background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">{action.title}</Text>
                          <Badge tone={action.priority === "high" ? "critical" : action.priority === "medium" ? "warning" : "info"}>
                            {action.priority === "high" ? t("scan.autoTab.upgradeWindow.high") : action.priority === "medium" ? t("scan.autoTab.upgradeWindow.medium") : t("scan.autoTab.upgradeWindow.low")}
                          </Badge>
                        </InlineStack>
                        {action.platform && <Badge>{getPlatformName(action.platform, t)}</Badge>}
                      </BlockStack>
                      {action.deadline && <Badge tone="warning">{`${t("scan.migrationActionsCard.deadline")} ${action.deadline}`}</Badge>}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {action.descriptionKey ? t(action.descriptionKey, action.descriptionParams) : action.description}
                    </Text>
                    <InlineStack gap="200" align="end">
                      {action.type === "migrate_script_tag" && action.scriptTagId != null && (
                        <Button size="slim" icon={InfoIcon} onClick={() => handleShowScriptTagGuidance(action.scriptTagId!, action.platform)}>{t("scan.migrationActionsCard.cleanGuide")}</Button>
                      )}
                      {action.type === "remove_duplicate" && action.webPixelGid && (
                        <Button tone="critical" size="slim" loading={isDeleting && pendingDelete?.gid === action.webPixelGid} onClick={() => handleDeleteWebPixel(action.webPixelGid!, action.platform)}>{t("scan.migrationActionsCard.removeDuplicate")}</Button>
                      )}
                      {action.type === "configure_pixel" && action.description?.includes("升级") && (
                        <Button size="slim" icon={RefreshIcon} loading={isUpgrading} onClick={handleUpgradePixelSettings}>{t("scan.migrationActionsCard.upgradeConfig")}</Button>
                      )}
                      {action.type === "configure_pixel" && !action.description?.includes("升级") && (
                        <Button size="slim" url="/app/migrate" icon={ArrowRightIcon}>{t("scan.migrationActionsCard.configurePixel")}</Button>
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
          assets={(auditAssets.filter((a): a is NonNullable<typeof a> => a !== null) as Array<Record<string, unknown> & { createdAt: string; updatedAt: string; migratedAt: string | null }>).map((asset) => ({
            ...asset,
            createdAt: new Date(asset.createdAt),
            updatedAt: new Date(asset.updatedAt),
            migratedAt: asset.migratedAt ? new Date(asset.migratedAt) : null,
          })) as AuditAssetRecord[]}
          currentPlan={planId === "pro" ? "growth" : planId === "free" || planId === "starter" || planId === "growth" || planId === "agency" ? planId : "free"}
          freeTierLimit={3}
          onAssetClick={(assetId) => { window.location.href = `/app/migrate?asset=${assetId}`; }}
        />
      )}
      {migrationProgress && migrationTimeline && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{t("scan.autoTab.migrationProgress.title")}</Text>
              <Badge tone={migrationProgress.completionRate === 100 ? "success" : "attention"}>
                {t("scan.autoTab.migrationProgress.completed", { percent: Math.round(migrationProgress.completionRate) })}
              </Badge>
            </InlineStack>
            <BlockStack gap="300">
              <ProgressBar progress={migrationProgress.completionRate} tone={migrationProgress.completionRate === 100 ? "success" : "primary"} size="medium" />
              <InlineStack gap="400" align="space-between" wrap>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">{t("scan.autoTab.migrationProgress.total", { count: migrationProgress.total })}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">{t("scan.autoTab.migrationProgress.stats", { completed: migrationProgress.completed, inProgress: migrationProgress.inProgress, pending: migrationProgress.pending })}</Text>
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
                  <Text as="h3" variant="headingSm">{t("scan.autoTab.migrationProgress.nextSteps")}</Text>
                  {migrationTimeline.assets
                    .filter((item) => item.canStart && item.asset.migrationStatus === "pending")
                    .slice(0, 3)
                    .map((item) => (
                      <Box key={item.asset.id} background="bg-surface-secondary" padding="300" borderRadius="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" fontWeight="semibold">{item.asset.displayName || item.asset.platform || t("scan.autoTab.migrationProgress.unknownAsset")}</Text>
                              <Badge tone={(item.asset.priority ?? item.priority.priority) >= 8 ? "critical" : (item.asset.priority ?? item.priority.priority) >= 5 ? undefined : "info"}>
                                {t("scan.autoTab.migrationProgress.priority", { priority: item.asset.priority ?? item.priority.priority })}
                              </Badge>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="subdued">{item.priority.reason || t("scan.autoTab.migrationProgress.noReason")}</Text>
                            {item.blockingDependencies.length > 0 && (
                              <Banner tone="warning">
                                <Text as="p" variant="bodySm">{t("scan.autoTab.migrationProgress.waitingDependencies", { count: item.blockingDependencies.length })}</Text>
                              </Banner>
                            )}
                          </BlockStack>
                          <InlineStack gap="200">
                            <Button size="slim" url={`/app/migrate?asset=${item.asset.id}`} disabled={!item.canStart}>{t("scan.actions.startMigration")}</Button>
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
                  {migrationTimeline.assets.filter((item) => item.canStart && item.asset.migrationStatus === "pending").length === 0 && (
                    <Banner tone="success">
                      <Text as="p" variant="bodySm">{t("scan.autoTab.migrationProgress.allReadyCompleted")}</Text>
                    </Banner>
                  )}
                </BlockStack>
                {dependencyGraph && "nodes" in dependencyGraph && "edges" in dependencyGraph && (
                  <>
                    <Divider />
                    <MigrationDependencyGraph dependencyGraph={dependencyGraph as DependencyGraph} />
                  </>
                )}
              </>
            )}
          </BlockStack>
        </Card>
      )}
    </Box>
  );
}
