import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Icon,
  Banner,
} from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, ArrowRightIcon, ClockIcon, LockIcon } from "~/components/icons";
import type { AuditAssetRecord } from "~/services/audit-asset.server";
import type { PlanId } from "~/services/billing/plans";

interface AuditAssetsByRiskProps {
  assets: AuditAssetRecord[];
  onAssetClick?: (assetId: string) => void;
  onMigrateClick?: (asset: AuditAssetRecord) => void;
  currentPlan?: PlanId;
  freeTierLimit?: number;
}

function determineRiskCategory(
  asset: AuditAssetRecord,
  riskLevel: "high" | "medium" | "low"
): "will_fail" | "can_replace" | "no_migration_needed" {
  if (riskLevel === "high") {
    return "will_fail";
  }
  if (asset.details && typeof asset.details === "object") {
    const details = asset.details as Record<string, unknown>;
    const displayScope = details.display_scope as string | undefined;
    if (displayScope === "order_status") {
      return "will_fail";
    }
  }
  if (riskLevel === "medium") {
    return "can_replace";
  }
  if (riskLevel === "low" || asset.suggestedMigration === "none") {
    return "no_migration_needed";
  }
  if (asset.category === "analytics") {
    return "no_migration_needed";
  }
  return "can_replace";
}

const MIGRATION_LABELS: Record<string, { label: string; description: string; url?: string }> = {
  web_pixel: {
    label: "迁移到 Web Pixel",
    description: "使用 Shopify Web Pixel Extension 替代客户端追踪",
    url: "/app/migrate",
  },
  ui_extension: {
    label: "UI Extension Block",
    description: "使用 Customer Accounts UI Extensions 替代页面脚本",
    url: "/app/modules",
  },
  server_side: {
    label: "Server-side CAPI",
    description: "使用服务端 Conversions API 提高追踪可靠性",
    url: "/app/migrate",
  },
  none: {
    label: "无需迁移",
    description: "此资产无需迁移，可保留或手动处理",
  },
};

const RISK_CATEGORY_INFO: Record<string, { label: string; tone: "critical" | "warning" | "info" | "success"; description: string; icon: typeof AlertCircleIcon }> = {
  will_fail: {
    label: "会失效/受限",
    tone: "critical",
    description: "这些资产在升级后将会失效或受到限制，必须优先迁移",
    icon: AlertCircleIcon,
  },
  can_replace: {
    label: "可直接替换",
    tone: "warning",
    description: "这些资产可以直接替换为新的实现方式，建议尽快迁移",
    icon: AlertCircleIcon,
  },
  no_migration_needed: {
    label: "无需迁移",
    tone: "success",
    description: "这些资产无需立即迁移，可以延后处理或保留",
    icon: CheckCircleIcon,
  },
};

export function AuditAssetsByRisk({
  assets,
  onAssetClick,
  onMigrateClick,
  currentPlan = "free",
  freeTierLimit = 3,
}: AuditAssetsByRiskProps) {
  const assetsByCategory = {
    will_fail: assets.filter((a) => {
      const category = determineRiskCategory(a, a.riskLevel as "high" | "medium" | "low");
      return category === "will_fail";
    }),
    can_replace: assets.filter((a) => {
      const category = determineRiskCategory(a, a.riskLevel as "high" | "medium" | "low");
      return category === "can_replace";
    }),
    no_migration_needed: assets.filter((a) => {
      const category = determineRiskCategory(a, a.riskLevel as "high" | "medium" | "low");
      return category === "no_migration_needed";
    }),
  };
  const highRiskAssets = assetsByCategory.will_fail;
  const mediumRiskAssets = assetsByCategory.can_replace;
  const totalHighRisk = highRiskAssets.length;
  const totalMediumRisk = mediumRiskAssets.length;
  const riskScore = totalHighRisk * 30 + totalMediumRisk * 15;
  const riskLevel = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";
  const getEstimatedTime = (asset: AuditAssetRecord): number => {
    if (asset.details && typeof asset.details === "object") {
      const details = asset.details as Record<string, unknown>;
      const time = details.estimatedTimeMinutes;
      if (typeof time === "number") return time;
    }
    return asset.riskLevel === "high" ? 30 : 20;
  };
  const estimatedTimeMinutes = highRiskAssets.reduce((sum, asset) =>
    sum + getEstimatedTime(asset), 0
  ) + mediumRiskAssets.reduce((sum, asset) =>
    sum + getEstimatedTime(asset), 0
  );
  const isFreeTier = currentPlan === "free";
  const visibleHighRiskAssets = isFreeTier
    ? highRiskAssets.slice(0, freeTierLimit)
    : highRiskAssets;
  const hiddenHighRiskCount = isFreeTier
    ? Math.max(0, totalHighRisk - freeTierLimit)
    : 0;
  const totalAssets = assets.length;
  const hasAssets = totalAssets > 0;
  const handleMigrateClick = (asset: AuditAssetRecord) => {
    if (onMigrateClick) {
      onMigrateClick(asset);
    } else if (asset.suggestedMigration === "web_pixel" && asset.platform) {
      window.location.href = `/app/migrate?platform=${asset.platform}&assetId=${asset.id}`;
    } else if (asset.suggestedMigration === "ui_extension") {
      window.location.href = `/app/modules?assetId=${asset.id}`;
    } else if (asset.suggestedMigration === "server_side") {
      window.location.href = `/app/migrate?assetId=${asset.id}`;
    }
  };
  if (!hasAssets) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            审计资产清单
          </Text>
          <Banner tone="info">
            <Text as="p" variant="bodySm">
              暂无审计资产。完成扫描后，资产清单将显示在这里。
            </Text>
          </Banner>
        </BlockStack>
      </Card>
    );
  }
  return (
    <Card>
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            审计资产清单
          </Text>
          <Badge tone="info">{`${totalAssets} 项`}</Badge>
        </InlineStack>
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              风险评分摘要
            </Text>
            <InlineStack gap="400" wrap>
              <Box minWidth="200px">
                <Box
                  background={
                    riskLevel === "high"
                      ? "bg-fill-critical"
                      : riskLevel === "medium"
                      ? "bg-fill-warning"
                      : "bg-fill-success"
                  }
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {riskScore}
                    </Text>
                    <Text as="p" variant="bodySm">
                      风险分数
                    </Text>
                    <Badge tone={riskLevel === "high" ? "critical" : riskLevel === "medium" ? undefined : "success"}>
                      {riskLevel === "high" ? "高风险" : riskLevel === "medium" ? "中风险" : "低风险"}
                    </Badge>
                  </BlockStack>
                </Box>
              </Box>
              <Box minWidth="200px">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    将失效/将断档
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {String(totalHighRisk)} 项
                  </Text>
                  <Text as="p" variant="bodySm">
                    预计修复时间: {estimatedTimeMinutes < 60
                      ? `${estimatedTimeMinutes} 分钟`
                      : `${Math.floor(estimatedTimeMinutes / 60)} 小时 ${estimatedTimeMinutes % 60} 分钟`}
                  </Text>
                </BlockStack>
              </Box>
              <Box minWidth="200px">
                <BlockStack gap="200">
                  {totalHighRisk > 0 && (
                    <BlockStack gap="200">
                      <Button
                        variant="primary"
                        size="large"
                        url="/app/migrate"
                        icon={ArrowRightIcon}
                      >
                        启用 Purchase-only 修复（约 {String(Math.ceil(estimatedTimeMinutes * 0.3))} 分钟）
                      </Button>
                      {currentPlan !== "free" && currentPlan !== "starter" && (
                        <Button
                          variant="secondary"
                          size="large"
                          url="/app/migrate?mode=full_funnel"
                          icon={ArrowRightIcon}
                        >
                          启用 Full-funnel 修复（约 {String(Math.ceil(estimatedTimeMinutes * 0.5))} 分钟，Growth）
                        </Button>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
        </Card>
        {assetsByCategory.will_fail.length > 0 && (
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={RISK_CATEGORY_INFO.will_fail.icon} tone="critical" />
                <Text as="h3" variant="headingSm" tone="critical">
                  {RISK_CATEGORY_INFO.will_fail.label}
                </Text>
                <Badge tone="critical">{`${assetsByCategory.will_fail.length} 项`}</Badge>
              </InlineStack>
            </InlineStack>
            <Banner tone="critical">
              <Text as="p" variant="bodySm">
                {RISK_CATEGORY_INFO.will_fail.description}
              </Text>
            </Banner>
            <BlockStack gap="200">
              {visibleHighRiskAssets.map((asset) => {
                const migrationInfo = MIGRATION_LABELS[asset.suggestedMigration] || MIGRATION_LABELS.none;
                return (
                  <Box
                    key={asset.id}
                    background="bg-surface-critical"
                    padding="400"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center" wrap>
                            <Text as="span" fontWeight="semibold">
                              {asset.displayName || asset.platform || "未知资产"}
                            </Text>
                            {asset.platform && (
                              <Badge>{asset.platform}</Badge>
                            )}
                            {(() => {
                              const priority = asset.details && typeof asset.details === "object"
                                ? (asset.details as Record<string, unknown>).priority
                                : undefined;
                              if (typeof priority === "number" && priority > 0) {
                                return (
                                  <Badge tone={priority >= 8 ? "critical" : undefined}>
                                    {`优先级 ${priority}/10`}
                                  </Badge>
                                );
                              }
                              return null;
                            })()}
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {asset.category === "pixel" ? "追踪像素" :
                             asset.category === "affiliate" ? "联盟追踪" :
                             asset.category === "survey" ? "售后问卷" :
                             asset.category === "support" ? "客服入口" :
                             asset.category === "analytics" ? "站内分析" :
                             "其他"}
                          </Text>
                        </BlockStack>
                        <Badge tone="critical">高风险</Badge>
                      </InlineStack>
                      <Divider />
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              推荐迁移方式
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {migrationInfo.label}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {migrationInfo.description}
                            </Text>
                          </BlockStack>
                          {migrationInfo.url && (
                            <Button
                              size="slim"
                              url={migrationInfo.url}
                              icon={ArrowRightIcon}
                              onClick={() => {
                                handleMigrateClick(asset);
                                onAssetClick?.(asset.id);
                              }}
                            >
                              一键迁移
                            </Button>
                          )}
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center" wrap>
                          {(() => {
                            const time = getEstimatedTime(asset);
                            if (time > 0) {
                              return (
                                <InlineStack gap="200" blockAlign="center">
                                  <Icon source={ClockIcon} />
                                  <Text as="span" variant="bodySm">
                                    预计耗时: {time < 60
                                      ? `${time} 分钟`
                                      : `${Math.floor(time / 60)} 小时 ${time % 60} 分钟`}
                                  </Text>
                                </InlineStack>
                              );
                            }
                            return null;
                          })()}
                          {(() => {
                            const priority = asset.details && typeof asset.details === "object"
                              ? (asset.details as Record<string, unknown>).priority
                              : undefined;
                            if (typeof priority === "number" && priority >= 8) {
                              return <Badge tone="critical">高优先级</Badge>;
                            }
                            return null;
                          })()}
                        </InlineStack>
                      </BlockStack>
                    </BlockStack>
                  </Box>
                );
              })}
              {hiddenHighRiskCount > 0 && (
                <Box
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={LockIcon} tone="subdued" />
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            还有 {hiddenHighRiskCount} 项高风险资产未显示
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          升级到 Migration 或更高套餐，查看完整风险清单和迁移建议
                        </Text>
                      </BlockStack>
                      <Button
                        variant="primary"
                        url="/app/billing"
                        icon={ArrowRightIcon}
                      >
                        升级解锁
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </BlockStack>
        )}
        {assetsByCategory.can_replace.length > 0 && (
          <>
            {assetsByCategory.will_fail.length > 0 && <Divider />}
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={RISK_CATEGORY_INFO.can_replace.icon} tone="warning" />
                  <Text as="h3" variant="headingSm">
                    {RISK_CATEGORY_INFO.can_replace.label}
                  </Text>
                  <Badge>{`${assetsByCategory.can_replace.length} 项`}</Badge>
                </InlineStack>
              </InlineStack>
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  {RISK_CATEGORY_INFO.can_replace.description}
                </Text>
              </Banner>
              <BlockStack gap="200">
                {assetsByCategory.can_replace.map((asset) => {
                  const migrationInfo = MIGRATION_LABELS[asset.suggestedMigration] || MIGRATION_LABELS.none;
                  return (
                    <Box
                      key={asset.id}
                      background="bg-surface-warning"
                      padding="400"
                      borderRadius="200"
                    >
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center" wrap>
                              <Text as="span" fontWeight="semibold">
                                {asset.displayName || asset.platform || "未知资产"}
                              </Text>
                              {asset.platform && (
                                <Badge>{asset.platform}</Badge>
                              )}
                              {(() => {
                                const priority = asset.details && typeof asset.details === "object"
                                  ? (asset.details as Record<string, unknown>).priority
                                  : undefined;
                                if (typeof priority === "number" && priority > 0) {
                                  return (
                                    <Badge tone={priority >= 5 ? undefined : "info"}>
                                      {`优先级 ${priority}/10`}
                                    </Badge>
                                  );
                                }
                                return null;
                              })()}
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {asset.category === "pixel" ? "追踪像素" :
                               asset.category === "affiliate" ? "联盟追踪" :
                               asset.category === "survey" ? "售后问卷" :
                               asset.category === "support" ? "客服入口" :
                               asset.category === "analytics" ? "站内分析" :
                               "其他"}
                            </Text>
                          </BlockStack>
                          <Badge tone="warning">中风险</Badge>
                        </InlineStack>
                        <Divider />
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" fontWeight="semibold">
                                推荐迁移方式
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {migrationInfo.label}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {migrationInfo.description}
                              </Text>
                            </BlockStack>
                            {migrationInfo.url && (
                              <Button
                                size="slim"
                                url={migrationInfo.url}
                                icon={ArrowRightIcon}
                                onClick={() => {
                                  handleMigrateClick(asset);
                                  onAssetClick?.(asset.id);
                                }}
                              >
                                一键迁移
                              </Button>
                            )}
                          </InlineStack>
                          <InlineStack gap="200" blockAlign="center" wrap>
                            {(() => {
                              const time = getEstimatedTime(asset);
                              if (time > 0) {
                                return (
                                  <InlineStack gap="200" blockAlign="center">
                                    <Icon source={ClockIcon} />
                                    <Text as="span" variant="bodySm">
                                      预计耗时: {time < 60
                                        ? `${time} 分钟`
                                        : `${Math.floor(time / 60)} 小时 ${time % 60} 分钟`}
                                    </Text>
                                  </InlineStack>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                              const priority = asset.details && typeof asset.details === "object"
                                ? (asset.details as Record<string, unknown>).priority
                                : undefined;
                              if (typeof priority === "number" && priority >= 5 && priority < 8) {
                                return <Badge>中优先级</Badge>;
                              }
                              return null;
                            })()}
                          </InlineStack>
                        </BlockStack>
                      </BlockStack>
                    </Box>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </>
        )}
        {assetsByCategory.no_migration_needed.length > 0 && (
          <>
            {(assetsByCategory.will_fail.length > 0 || assetsByCategory.can_replace.length > 0) && <Divider />}
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={RISK_CATEGORY_INFO.no_migration_needed.icon} tone="success" />
                  <Text as="h3" variant="headingSm">
                    {RISK_CATEGORY_INFO.no_migration_needed.label}
                  </Text>
                  <Badge tone="success">{`${assetsByCategory.no_migration_needed.length} 项`}</Badge>
                </InlineStack>
              </InlineStack>
              <Banner tone="success">
                <Text as="p" variant="bodySm">
                  {RISK_CATEGORY_INFO.no_migration_needed.description}
                </Text>
              </Banner>
              <BlockStack gap="200">
                {assetsByCategory.no_migration_needed.map((asset) => {
                  const migrationInfo = MIGRATION_LABELS[asset.suggestedMigration] || MIGRATION_LABELS.none;
                  return (
                    <Box
                      key={asset.id}
                      background="bg-surface-success"
                      padding="400"
                      borderRadius="200"
                    >
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center" wrap>
                              <Text as="span" fontWeight="semibold">
                                {asset.displayName || asset.platform || "未知资产"}
                              </Text>
                              {asset.platform && (
                                <Badge>{asset.platform}</Badge>
                              )}
                              {(() => {
                                const priority = asset.details && typeof asset.details === "object"
                                  ? (asset.details as Record<string, unknown>).priority
                                  : undefined;
                                if (typeof priority === "number" && priority > 0) {
                                  return (
                                    <Badge tone="info">
                                      {`优先级 ${priority}/10`}
                                    </Badge>
                                  );
                                }
                                return null;
                              })()}
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {asset.category === "pixel" ? "追踪像素" :
                               asset.category === "affiliate" ? "联盟追踪" :
                               asset.category === "survey" ? "售后问卷" :
                               asset.category === "support" ? "客服入口" :
                               asset.category === "analytics" ? "站内分析" :
                               "其他"}
                            </Text>
                          </BlockStack>
                          <Badge tone="success">低风险</Badge>
                        </InlineStack>
                        <Divider />
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" fontWeight="semibold">
                                推荐迁移方式
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {migrationInfo.label}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {migrationInfo.description}
                              </Text>
                            </BlockStack>
                            {migrationInfo.url && asset.suggestedMigration !== "none" && (
                              <Button
                                size="slim"
                                url={migrationInfo.url}
                                icon={ArrowRightIcon}
                                onClick={() => {
                                  handleMigrateClick(asset);
                                  onAssetClick?.(asset.id);
                                }}
                              >
                                查看详情
                              </Button>
                            )}
                          </InlineStack>
                          {(() => {
                            const time = getEstimatedTime(asset);
                            if (time > 0) {
                              return (
                                <InlineStack gap="200" blockAlign="center">
                                  <Icon source={ClockIcon} />
                                  <Text as="span" variant="bodySm">
                                    预计耗时: {time < 60
                                      ? `${time} 分钟`
                                      : `${Math.floor(time / 60)} 小时 ${time % 60} 分钟`}
                                  </Text>
                                </InlineStack>
                              );
                            }
                            return null;
                          })()}
                        </BlockStack>
                      </BlockStack>
                    </Box>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
}
