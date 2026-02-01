import { memo, useMemo } from "react";
import { Card, BlockStack, InlineStack, Text, Divider, Badge, Button, List } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export const QuickStatsCard = memo(function QuickStatsCard({
  configuredPlatforms,
  weeklyConversions,
  plan,
  planLabel,
  planTagline,
  planFeatures,
}: {
  configuredPlatforms: number;
  weeklyConversions: number;
  plan: string;
  planLabel?: string;
  planTagline?: string;
  planFeatures?: string[];
}) {
  const { t } = useTranslation();
  const displayFeatures = useMemo(() => planFeatures?.slice(0, 3) || [], [planFeatures]);
  const hasMoreFeatures = useMemo(() => (planFeatures?.length || 0) > 3, [planFeatures]);
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("dashboard.quickStats.title")}
        </Text>
        <BlockStack gap="300">
          <InlineStack align="space-between">
            <Text as="span">{t("dashboard.quickStats.configuredPlatforms")}</Text>
            <Text as="span" fontWeight="semibold">
              {configuredPlatforms} {t("dashboard.quickStats.unit")}
            </Text>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between">
            <Text as="span">{t("dashboard.quickStats.weeklyConversions")}</Text>
            <Text as="span" fontWeight="semibold">
              {weeklyConversions} {t("dashboard.quickStats.records")}
            </Text>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between">
            <Text as="span">{t("dashboard.quickStats.currentPlan")}</Text>
            <Badge>
              {planLabel || (plan === "free" ? t("dashboard.quickStats.freePlan") : plan)}
            </Badge>
          </InlineStack>
          {planTagline && (
            <Text as="p" variant="bodySm" tone="subdued">
              {planTagline}
            </Text>
          )}
          {displayFeatures.length > 0 && (
            <List>
              {displayFeatures.map((f, i) => (
                <List.Item key={i}>
                  <Text as="span" variant="bodySm">{f}</Text>
                </List.Item>
              ))}
              {hasMoreFeatures && (
                <List.Item>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("dashboard.quickStats.moreFeatures")}
                  </Text>
                </List.Item>
              )}
            </List>
          )}
          <Button
            url="/app/settings?tab=subscription"
            size="slim"
          >
            {t("dashboard.quickStats.viewPlan")}
          </Button>
        </BlockStack>
      </BlockStack>
    </Card>
  );
});
