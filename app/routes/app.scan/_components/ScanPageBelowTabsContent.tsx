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
import { ExportIcon, SearchIcon, ArrowRightIcon, RefreshIcon, InfoIcon, ClockIcon, AlertCircleIcon } from "~/components/icons";
import { CardSkeleton, EnhancedEmptyState } from "~/components/ui";
import { getPlatformName, getSeverityBadge } from "~/components/scan";
import { MigrationDependencyGraph } from "~/components/scan/MigrationDependencyGraph";
import { AuditAssetsByRisk } from "~/components/scan/AuditAssetsByRisk";
import { ScanSummaryCards } from "./ScanSummaryCards";
import { MigrationImpactAnalysis } from "./MigrationImpactAnalysis";
import type { MigrationTimeline } from "~/services/migration-priority.server";
import type { AuditAssetRecord } from "~/services/audit-asset.server";
import type { DependencyGraph } from "~/services/dependency-analysis.server";

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
  showError,
  showSuccess,
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
  const handleExportCSV = async () => {
    if (!latestScan) return;
    try {
      const response = await fetch(`/api/scan-report/csv?reportId=${encodeURIComponent(latestScan.id)}`);
      if (!response.ok) {
        let msg = "导出失败";
        try {
          const errorData = await response.json();
          msg = errorData.error || msg;
        } catch {
          //
        }
        showError(msg);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scan-report-${latestScan.id}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccess("扫描报告 CSV 导出成功");
    } catch (error) {
      showError("导出失败：" + (error instanceof Error ? error.message : "未知错误"));
    }
  };

  return (
    <Box paddingBlockStart="400">
      <InlineStack align="space-between">
        {latestScan && (
          <InlineStack gap="200">
            <Button icon={ExportIcon} onClick={handleExportCSV}>
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
          title="还没有扫描报告"
          description="点击开始扫描，我们会自动检测 ScriptTags 和已安装的像素配置，并给出风险等级与迁移建议。预计耗时约 10 秒，不会修改任何设置。"
          helpText="关于 Additional Scripts：Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts。请切换到「手动分析」标签页，粘贴脚本内容进行分析。"
          primaryAction={{ content: "开始扫描", onAction: handleScan }}
          secondaryAction={{ content: "了解更多", url: "https://help.shopify.com/en/manual/pixels/web-pixels" }}
        />
      )}
      {latestScan && !isScanning && upgradeStatus?.title && upgradeStatus?.message && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Shopify 升级风险窗口</Text>
              <Badge tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"}>
                {upgradeStatus.urgency === "critical" ? "紧急" : upgradeStatus.urgency === "high" ? "高优先级" : upgradeStatus.urgency === "medium" ? "中优先级" : "低优先级"}
              </Badge>
            </InlineStack>
            <Divider />
            <Banner tone={upgradeStatus.urgency === "critical" ? "critical" : upgradeStatus.urgency === "high" ? "warning" : "info"} title={upgradeStatus.title}>
              <BlockStack gap="200">
                <Text as="p">{upgradeStatus.message}</Text>
                {upgradeStatus.autoUpgradeInfo?.autoUpgradeMessage && (
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
              <Text as="h2" variant="headingMd">风险详情</Text>
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
                            {getSeverityBadge(item.severity)}
                          </InlineStack>
                          <Text as="p" tone="subdued">{item.description}</Text>
                          {item.details && <Text as="p" variant="bodySm">{item.details}</Text>}
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200">
                              {item.platform && <Badge>{getPlatformName(item.platform)}</Badge>}
                              {item.impact && <Text as="span" variant="bodySm" tone="critical">影响: {item.impact}</Text>}
                            </InlineStack>
                            <Button url={`/app/migrate${item.platform ? `?platform=${item.platform}` : ""}`} size="slim" icon={ArrowRightIcon}>一键迁移</Button>
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
                          <Button url="/app/billing" variant="primary" size="slim">升级解锁完整报告</Button>
                          <Button url="/app/migrate" size="slim">启用 Purchase-only 修复（10 分钟）</Button>
                        </InlineStack>
                      </BlockStack>
                    </Banner>
                  )}
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" fontWeight="semibold">预计修复时间</Text>
                        <Badge tone={estimatedTimeMinutes > 60 ? "warning" : "info"}>
                          {estimatedTimeMinutes > 60 ? `${Math.floor(estimatedTimeMinutes / 60)} 小时 ${estimatedTimeMinutes % 60} 分钟` : `${estimatedTimeMinutes} 分钟`}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">基于当前风险项数量和严重程度估算</Text>
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
      {latestScan && migrationActions.length > 0 && !isScanning && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">迁移操作</Text>
              <Badge tone="attention">{`${migrationActions.length} 项待处理`}</Badge>
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
                            {action.priority === "high" ? "高优先级" : action.priority === "medium" ? "中优先级" : "低优先级"}
                          </Badge>
                        </InlineStack>
                        {action.platform && <Badge>{getPlatformName(action.platform)}</Badge>}
                      </BlockStack>
                      {action.deadline && <Badge tone="warning">{`截止: ${action.deadline}`}</Badge>}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">{action.description}</Text>
                    <InlineStack gap="200" align="end">
                      {action.type === "migrate_script_tag" && action.scriptTagId != null && (
                        <Button size="slim" icon={InfoIcon} onClick={() => handleShowScriptTagGuidance(action.scriptTagId!, action.platform)}>查看清理指南</Button>
                      )}
                      {action.type === "remove_duplicate" && action.webPixelGid && (
                        <Button tone="critical" size="slim" loading={isDeleting && pendingDelete?.gid === action.webPixelGid} onClick={() => handleDeleteWebPixel(action.webPixelGid!, action.platform)}>删除重复像素</Button>
                      )}
                      {action.type === "configure_pixel" && action.description?.includes("升级") && (
                        <Button size="slim" icon={RefreshIcon} loading={isUpgrading} onClick={handleUpgradePixelSettings}>升级配置</Button>
                      )}
                      {action.type === "configure_pixel" && !action.description?.includes("升级") && (
                        <Button size="slim" url="/app/migrate" icon={ArrowRightIcon}>配置 Pixel</Button>
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
              <Text as="h2" variant="headingMd">📊 迁移进度</Text>
              <Badge tone={migrationProgress.completionRate === 100 ? "success" : "attention"}>
                {`${Math.round(migrationProgress.completionRate)}% 完成`}
              </Badge>
            </InlineStack>
            <BlockStack gap="300">
              <ProgressBar progress={migrationProgress.completionRate} tone={migrationProgress.completionRate === 100 ? "success" : "primary"} size="medium" />
              <InlineStack gap="400" align="space-between" wrap>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">总计: {migrationProgress.total} 项</Text>
                  <Text as="span" variant="bodySm" tone="subdued">已完成: {migrationProgress.completed} | 进行中: {migrationProgress.inProgress} | 待处理: {migrationProgress.pending}</Text>
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
                  <Text as="h3" variant="headingSm">下一步建议</Text>
                  {migrationTimeline.assets
                    .filter((item) => item.canStart && item.asset.migrationStatus === "pending")
                    .slice(0, 3)
                    .map((item) => (
                      <Box key={item.asset.id} background="bg-surface-secondary" padding="300" borderRadius="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" fontWeight="semibold">{item.asset.displayName || item.asset.platform || "未知资产"}</Text>
                              <Badge tone={(item.asset.priority ?? item.priority.priority) >= 8 ? "critical" : (item.asset.priority ?? item.priority.priority) >= 5 ? undefined : "info"}>
                                {`优先级 ${item.asset.priority ?? item.priority.priority}/10`}
                              </Badge>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="subdued">{item.priority.reason || "无说明"}</Text>
                            {item.blockingDependencies.length > 0 && (
                              <Banner tone="warning">
                                <Text as="p" variant="bodySm">等待 {item.blockingDependencies.length} 个依赖项完成</Text>
                              </Banner>
                            )}
                          </BlockStack>
                          <InlineStack gap="200">
                            <Button size="slim" url={`/app/migrate?asset=${item.asset.id}`} disabled={!item.canStart}>开始迁移</Button>
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
                  {migrationTimeline.assets.filter((item) => item.canStart && item.asset.migrationStatus === "pending").length === 0 && (
                    <Banner tone="success">
                      <Text as="p" variant="bodySm">所有可立即开始的迁移任务已完成！请检查是否有依赖项需要先完成。</Text>
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
