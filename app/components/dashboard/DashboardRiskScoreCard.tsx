import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Badge, BlockStack, Box, Card, Divider, InlineStack, List, Text } from "@shopify/polaris";

export const DashboardRiskScoreCard = memo(function DashboardRiskScoreCard({
  riskScore,
  riskLevel,
  estimatedMigrationTimeMinutes,
  topRiskSources,
}: {
  riskScore?: number | null;
  riskLevel?: "high" | "medium" | "low" | null;
  estimatedMigrationTimeMinutes?: number | null;
  topRiskSources?: Array<{ source: string; count: number; category: string }>;
}) {
  const { t } = useTranslation();
  const riskBadge =
    riskLevel === "high"
      ? { tone: "critical" as const, label: t("dashboardRiskScore.riskLevel.high") }
      : riskLevel === "medium"
        ? { tone: "warning" as const, label: t("dashboardRiskScore.riskLevel.medium") }
        : riskLevel === "low"
          ? { tone: "success" as const, label: t("dashboardRiskScore.riskLevel.low") }
          : { tone: "info" as const, label: t("dashboardRiskScore.riskLevel.pending") };
  const formatEstimatedTime = (minutes: number | null): string => {
    if (minutes === null) return t("dashboardRiskScore.estimatedTime.calculating");
    if (minutes < 60) return t("dashboardRiskScore.estimatedTime.minutes", { minutes });
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? t("dashboardRiskScore.estimatedTime.hoursAndMinutes", { hours, mins }) : t("dashboardRiskScore.estimatedTime.hours", { hours });
  };
  const riskColor = riskLevel === "high"
    ? "bg-fill-critical"
    : riskLevel === "medium"
      ? "bg-fill-caution"
      : riskLevel === "low"
        ? "bg-fill-success"
        : "bg-surface-secondary";
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("dashboardRiskScore.title")}
        </Text>
        <Box background={riskColor} padding="600" borderRadius="200">
          <BlockStack gap="200" align="center">
            {riskScore != null ? (
              <>
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {riskScore}
                </Text>
                <Text as="p" variant="bodySm">/ 100</Text>
              </>
            ) : (
              <>
                <Text as="p" variant="headingLg" fontWeight="semibold">
                  {t("dashboardRiskScore.pendingAssessment")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("dashboardRiskScore.showAfterScan")}
                </Text>
              </>
            )}
          </BlockStack>
        </Box>
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {t("dashboardRiskScore.riskLevelLabel")}
          </Text>
          <Badge tone={riskBadge.tone}>{riskBadge.label}</Badge>
        </InlineStack>
        <Divider />
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {t("dashboardRiskScore.estimatedMigrationTime")}
          </Text>
          <Text as="span" variant="bodyMd">
            {formatEstimatedTime(estimatedMigrationTimeMinutes ?? null)}
          </Text>
        </InlineStack>
        {topRiskSources && topRiskSources.length > 0 && (
          <>
            <Divider />
            <BlockStack gap="200">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {t("dashboardRiskScore.topRiskSources")}
              </Text>
              <List>
                {topRiskSources.map((source, index) => (
                  <List.Item key={`${source.category}-${source.source}`}>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm">
                        {index + 1}. {source.source}
                      </Text>
                      <Badge tone="critical">{t("dashboardRiskScore.sourceCount", { count: source.count })}</Badge>
                    </InlineStack>
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
});
