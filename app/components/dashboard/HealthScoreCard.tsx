import { memo, useMemo } from "react";
import { Card, BlockStack, InlineStack, Text, Box, Badge } from "@shopify/polaris";
import type { DashboardData } from "~/types/dashboard";
import { useTranslation } from "react-i18next";

const HealthBadge = memo(function HealthBadge({ status }: { status: DashboardData["healthStatus"] }) {
  const { t } = useTranslation();
  switch (status) {
    case "critical":
      return <Badge tone="critical">{t("dashboard.healthScore.statusCritical")}</Badge>;
    case "warning":
      return <Badge tone="warning">{t("dashboard.healthScore.statusWarning")}</Badge>;
    case "success":
      return <Badge tone="success">{t("dashboard.healthScore.statusSuccess")}</Badge>;
    default:
      return <Badge tone="info">{t("dashboard.healthScore.statusUnknown")}</Badge>;
  }
});

export const HealthScoreCard = memo(function HealthScoreCard({
  score,
  status,
  rejectionStats,
}: {
  score: number | null;
  status: DashboardData["healthStatus"];
  rejectionStats?: DashboardData["rejectionStats"];
}) {
  const { t } = useTranslation();
  const backgroundColor = useMemo(() =>
    score === null
      ? "bg-surface-secondary"
      : score > 80
        ? "bg-fill-success"
        : score > 60
          ? "bg-fill-warning"
          : "bg-fill-critical",
    [score]
  );
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            {t("dashboard.healthScore.title")}
          </Text>
          <HealthBadge status={status} />
        </InlineStack>
        <Box background={backgroundColor} padding="600" borderRadius="200">
          <BlockStack gap="200" align="center">
            {score !== null ? (
              <>
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {score}
                </Text>
                <Text as="p" variant="bodySm">
                  / 100
                </Text>
              </>
            ) : (
              <>
                <Text as="p" variant="headingLg" fontWeight="semibold">
                  {t("dashboard.healthScore.notInitializedTitle")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("dashboard.healthScore.notInitializedDesc")}
                </Text>
              </>
            )}
          </BlockStack>
        </Box>
        <Text as="p" variant="bodySm" tone="subdued">
          {score !== null
            ? t("dashboard.healthScore.desc")
            : t("dashboard.healthScore.descUnknown")}
        </Text>
        {rejectionStats && rejectionStats.length > 0 && (
          <Box paddingBlockStart="400" width="100%">
             <BlockStack gap="200">
               <Text as="h3" variant="headingSm" tone="critical">Pixel Health (Last 1h)</Text>
               {rejectionStats.slice(0, 3).map((stat) => (
                 <InlineStack key={stat.reason} align="space-between">
                   <Text as="span" variant="bodySm" tone="subdued">{stat.reason}</Text>
                   <Badge tone="critical">{String(stat.count)}</Badge>
                 </InlineStack>
               ))}
             </BlockStack>
          </Box>
        )}
      </BlockStack>
    </Card>
  );
});
