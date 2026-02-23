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
import { useTranslation } from "react-i18next";
import { useMemo } from "react";

interface AuditAssetsByRiskProps {
  assets: AuditAssetRecord[];
  onAssetClick?: (assetId: string) => void;
  onMigrateClick?: (asset: AuditAssetRecord) => void;
  onNavigate?: (url: string) => void;
  currentPlan?: PlanId;
  freeTierLimit?: number;
  riskScore?: number;
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
  if (asset.suggestedMigration === "none" || asset.category === "analytics") {
    return "no_migration_needed";
  }
  if (riskLevel === "medium") {
    return "can_replace";
  }
  if (riskLevel === "low") {
    return "no_migration_needed";
  }
  return "can_replace";
}

const getEstimatedTime = (asset: AuditAssetRecord): number => {
  if (typeof asset.estimatedTimeMinutes === "number") {
    return asset.estimatedTimeMinutes;
  }
  if (asset.details && typeof asset.details === "object") {
    const details = asset.details as Record<string, unknown>;
    const time = details.estimatedTimeMinutes;
    if (typeof time === "number") return time;
  }
  const riskMap: Record<string, number> = { high: 30, medium: 15, low: 5 };
  return riskMap[asset.riskLevel || "low"] || 10;
};

const getPriority = (asset: AuditAssetRecord): number | undefined => {
  if (typeof asset.priority === "number") return asset.priority;
  if (asset.details && typeof asset.details === "object") {
    return (asset.details as Record<string, unknown>).priority as number | undefined;
  }
  return undefined;
};

export function AuditAssetsByRisk({
  assets,
  onAssetClick,
  onMigrateClick,
  onNavigate,
  currentPlan = "free",
  freeTierLimit = 3,
  riskScore: providedRiskScore,
}: AuditAssetsByRiskProps) {
  const { t } = useTranslation();

  const getRiskCategoryInfo = (category: "will_fail" | "can_replace" | "no_migration_needed") => {
    const map = {
      will_fail: {
        label: t("scan.risk.category.willFail.label"),
        tone: "critical" as const,
        description: t("scan.risk.category.willFail.desc"),
        icon: AlertCircleIcon,
      },
      can_replace: {
        label: t("scan.risk.category.canReplace.label"),
        tone: "warning" as const,
        description: t("scan.risk.category.canReplace.desc"),
        icon: AlertCircleIcon,
      },
      no_migration_needed: {
        label: t("scan.risk.category.noMigrationNeeded.label"),
        tone: "success" as const,
        description: t("scan.risk.category.noMigrationNeeded.desc"),
        icon: CheckCircleIcon,
      },
    };
    return map[category];
  };

  const getMigrationLabel = (migration: string) => {
    const map: Record<string, { label: string; description: string; url?: string }> = {
      web_pixel: {
        label: t("scan.risk.migrationLabel.webPixel.label"),
        description: t("scan.risk.migrationLabel.webPixel.desc"),
        url: "/app/migrate",
      },
      ui_extension: {
        label: t("scan.risk.migrationLabel.uiExtension.label"),
        description: t("scan.risk.migrationLabel.uiExtension.desc"),
        url: "/app/migrate",
      },
      server_side: {
        label: t("scan.risk.migrationLabel.serverSide.label"),
        description: t("scan.risk.migrationLabel.serverSide.desc"),
        url: "/app/migrate",
      },
      none: {
        label: t("scan.risk.migrationLabel.none.label"),
        description: t("scan.risk.migrationLabel.none.desc"),
      },
    };
    return map[migration] || map.none;
  };

  const assetsByCategory = useMemo(() => ({
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
  }), [assets]);

  const highRiskAssets = assetsByCategory.will_fail;
  const mediumRiskAssets = assetsByCategory.can_replace;
  const totalHighRisk = highRiskAssets.length;
  const totalMediumRisk = mediumRiskAssets.length;
  
  const calculatedRiskScore = useMemo(() => totalHighRisk * 30 + totalMediumRisk * 15, [totalHighRisk, totalMediumRisk]);
  const riskScore = providedRiskScore ?? calculatedRiskScore;
  const riskLevel = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";
  
  const estimatedTimeMinutes = useMemo(() => highRiskAssets.reduce((sum, asset) =>
    sum + getEstimatedTime(asset), 0
  ) + mediumRiskAssets.reduce((sum, asset) =>
    sum + getEstimatedTime(asset), 0
  ), [highRiskAssets, mediumRiskAssets]);

  const isFreeTier = currentPlan === "free";
  const visibleHighRiskAssets = isFreeTier
    ? highRiskAssets.slice(0, freeTierLimit)
    : highRiskAssets;
  const hiddenHighRiskCount = isFreeTier
    ? Math.max(0, totalHighRisk - freeTierLimit)
    : 0;
  const totalAssets = assets.length;
  const hasAssets = totalAssets > 0;
  const doNavigate = (url: string) => {
    if (onNavigate) {
      onNavigate(url);
    } else {
      window.location.href = url;
    }
  };

  const handleMigrateClick = (asset: AuditAssetRecord) => {
    if (onMigrateClick) {
      onMigrateClick(asset);
    } else if (asset.suggestedMigration === "web_pixel" && asset.platform) {
      doNavigate(`/app/migrate?platform=${asset.platform}&assetId=${asset.id}`);
    } else if (asset.suggestedMigration === "ui_extension") {
      doNavigate(`/app/migrate?assetId=${asset.id}`);
    }
  };

  const getAssetCategoryName = (cat: string) => {
    const map: Record<string, string> = {
      pixel: t("scan.risk.assetCategory.pixel"),
      affiliate: t("scan.risk.assetCategory.affiliate"),
      survey: t("scan.risk.assetCategory.survey"),
      support: t("scan.risk.assetCategory.support"),
      analytics: t("scan.risk.assetCategory.analytics"),
      other: t("scan.risk.assetCategory.other"),
    };
    return map[cat] || t("scan.risk.assetCategory.other");
  };

  if (!hasAssets) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("scan.risk.assetList")}
          </Text>
          <Banner tone="info">
            <Text as="p" variant="bodySm">
              {t("scan.risk.emptyList")}
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
            {t("scan.risk.assetList")}
          </Text>
          <Badge tone="info">{t("common.countItems", { count: totalAssets })}</Badge>
        </InlineStack>
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              {t("scan.risk.scoreSummary")}
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
                      {t("scan.risk.riskScore")}
                    </Text>
                    <Badge tone={riskLevel === "high" ? "critical" : riskLevel === "medium" ? undefined : "success"}>
                      {t(`scan.risk.level.${riskLevel}`)}
                    </Badge>
                  </BlockStack>
                </Box>
              </Box>
              <Box minWidth="200px">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    {t("scan.risk.willFailOrBreak")}
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {t("common.countItems", { count: totalHighRisk })}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("scan.risk.estimatedFixTime")}: {estimatedTimeMinutes < 60
                      ? t("common.minutes", { count: estimatedTimeMinutes })
                      : `${Math.floor(estimatedTimeMinutes / 60)} ${t("common.hours")} ${estimatedTimeMinutes % 60} ${t("common.minutes")}`}
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
                        {t("scan.risk.enablePurchaseFix", { time: String(Math.ceil(estimatedTimeMinutes * 0.3)) })}
                      </Button>
                      {currentPlan !== "free" && currentPlan !== "starter" && (
                        <Button
                          variant="secondary"
                          size="large"
                          url="/app/migrate?mode=full_funnel"
                          icon={ArrowRightIcon}
                        >
                          {t("scan.risk.enableFullFunnelFix", { time: String(Math.ceil(estimatedTimeMinutes * 0.5)) })}
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
                <Icon source={getRiskCategoryInfo("will_fail").icon} tone="critical" />
                <Text as="h3" variant="headingSm" tone="critical">
                  {getRiskCategoryInfo("will_fail").label}
                </Text>
                <Badge tone="critical">{t("common.countItems", { count: assetsByCategory.will_fail.length })}</Badge>
              </InlineStack>
            </InlineStack>
            <Banner tone="critical">
              <Text as="p" variant="bodySm">
                {getRiskCategoryInfo("will_fail").description}
              </Text>
            </Banner>
            <BlockStack gap="200">
              {visibleHighRiskAssets.map((asset) => {
                const migrationInfo = getMigrationLabel(asset.suggestedMigration);
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
                              {asset.displayName || asset.platform || t("common.unknownAsset")}
                            </Text>
                            {asset.platform && (
                              <Badge>{asset.platform}</Badge>
                            )}
                            {(() => {
                              const priority = getPriority(asset);
                              if (typeof priority === "number" && priority > 0) {
                                return (
                                  <Badge tone={priority >= 8 ? "critical" : undefined}>
                                    {t("scan.risk.priority", { level: priority })}
                                  </Badge>
                                );
                              }
                              return null;
                            })()}
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {getAssetCategoryName(asset.category)}
                          </Text>
                        </BlockStack>
                        <Badge tone="critical">{t("scan.risk.level.high")}</Badge>
                      </InlineStack>
                      <Divider />
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {t("scan.risk.recommendedMigration")}
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
                              {t("scan.risk.oneClickMigrate")}
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
                                    {t("scan.risk.estimatedTime")}
                                    {time < 60
                                      ? t("common.minutes", { count: time })
                                      : `${Math.floor(time / 60)} ${t("common.hours")} ${time % 60} ${t("common.minutes")}`}
                                  </Text>
                                </InlineStack>
                              );
                            }
                            return null;
                          })()}
                          {(() => {
                            const priority = getPriority(asset);
                            if (typeof priority === "number" && priority >= 8) {
                              return <Badge tone="critical">{t("scan.risk.highPriority")}</Badge>;
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
                            {t("scan.risk.hiddenAssets", { count: hiddenHighRiskCount })}
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("scan.risk.upgradeHint")}
                        </Text>
                      </BlockStack>
                      <Button
                        variant="primary"
                        url="/app/billing"
                        icon={ArrowRightIcon}
                      >
                        {t("scan.risk.upgradeUnlock")}
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
                  <Icon source={getRiskCategoryInfo("can_replace").icon} tone="warning" />
                  <Text as="h3" variant="headingSm">
                    {getRiskCategoryInfo("can_replace").label}
                  </Text>
                  <Badge>{t("common.countItems", { count: assetsByCategory.can_replace.length })}</Badge>
                </InlineStack>
              </InlineStack>
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  {getRiskCategoryInfo("can_replace").description}
                </Text>
              </Banner>
              <BlockStack gap="200">
                {assetsByCategory.can_replace.map((asset) => {
                  const migrationInfo = getMigrationLabel(asset.suggestedMigration);
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
                                {asset.displayName || asset.platform || t("common.unknownAsset")}
                              </Text>
                              {asset.platform && (
                                <Badge>{asset.platform}</Badge>
                              )}
                              {(() => {
                              const priority = getPriority(asset);
                              if (typeof priority === "number" && priority > 0) {
                                  return (
                                    <Badge tone={priority >= 5 ? undefined : "info"}>
                                      {t("scan.risk.priority", { level: priority })}
                                    </Badge>
                                  );
                                }
                                return null;
                              })()}
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {getAssetCategoryName(asset.category)}
                            </Text>
                          </BlockStack>
                          <Badge tone="warning">{t("scan.risk.level.medium")}</Badge>
                        </InlineStack>
                        <Divider />
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" fontWeight="semibold">
                                {t("scan.risk.recommendedMigration")}
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
                                {t("scan.risk.oneClickMigrate")}
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
                                      {t("scan.risk.estimatedTime")}
                                      {time < 60
                                        ? t("common.minutes", { count: time })
                                        : `${Math.floor(time / 60)} ${t("common.hours")} ${time % 60} ${t("common.minutes")}`}
                                    </Text>
                                  </InlineStack>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                            const priority = getPriority(asset);
                            if (typeof priority === "number" && priority >= 5 && priority < 8) {
                                return <Badge>{t("scan.risk.mediumPriority")}</Badge>;
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
                  <Icon source={getRiskCategoryInfo("no_migration_needed").icon} tone="success" />
                  <Text as="h3" variant="headingSm">
                    {getRiskCategoryInfo("no_migration_needed").label}
                  </Text>
                  <Badge tone="success">{t("common.countItems", { count: assetsByCategory.no_migration_needed.length })}</Badge>
                </InlineStack>
              </InlineStack>
              <Banner tone="success">
                <Text as="p" variant="bodySm">
                  {getRiskCategoryInfo("no_migration_needed").description}
                </Text>
              </Banner>
              <BlockStack gap="200">
                {assetsByCategory.no_migration_needed.map((asset) => {
                  const migrationInfo = getMigrationLabel(asset.suggestedMigration);
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
                                {asset.displayName || asset.platform || t("common.unknownAsset")}
                              </Text>
                              {asset.platform && (
                                <Badge>{asset.platform}</Badge>
                              )}
                              {(() => {
                              const priority = getPriority(asset);
                              if (typeof priority === "number" && priority > 0) {
                                  return (
                                    <Badge tone="info">
                                      {t("scan.risk.priority", { level: priority })}
                                    </Badge>
                                  );
                                }
                                return null;
                              })()}
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {getAssetCategoryName(asset.category)}
                            </Text>
                          </BlockStack>
                          <Badge tone="success">{t("scan.risk.level.low")}</Badge>
                        </InlineStack>
                        <Divider />
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" fontWeight="semibold">
                                {t("scan.risk.recommendedMigration")}
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
                                {t("scan.risk.viewDetails")}
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
                                    {t("scan.risk.estimatedTime")}
                                    {time < 60
                                      ? t("common.minutes", { count: time })
                                      : `${Math.floor(time / 60)} ${t("common.hours")} ${time % 60} ${t("common.minutes")}`}
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
