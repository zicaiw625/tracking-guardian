import { Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Box, Divider, Icon, Banner } from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { getPlatformName } from "~/components/scan/utils";
import { safeFormatDate, validateRiskItemsArray } from "~/utils/scan-data-validation";
import { calculateEstimatedTime, getRiskLevelBackground, getRiskLevelBadgeTone } from "~/utils/scan-format";
import { isPlanAtLeast } from "~/utils/plans";
import { useTranslation } from "react-i18next";

interface ScanSummaryCardsProps {
  latestScan: {
    riskScore: number;
    createdAt: unknown;
    riskItems?: unknown;
  };
  identifiedPlatforms: string[];
  scriptTags: Array<{ id: number }>;
  deprecationStatus?: {
    scriptTag?: {
      isExpired: boolean;
      badge: { text: string };
      description: string;
    };
  } | null;
  planIdSafe: string;
}

export function ScanSummaryCards({
  latestScan,
  identifiedPlatforms,
  scriptTags,
  deprecationStatus,
  planIdSafe,
}: ScanSummaryCardsProps) {
  const { t } = useTranslation();
  const riskItems = validateRiskItemsArray(latestScan.riskItems);
  const estimatedTime = calculateEstimatedTime(riskItems);
  const riskBackground = getRiskLevelBackground(latestScan.riskScore);
  const riskBadgeTone = getRiskLevelBadgeTone(latestScan.riskScore);
  const riskLevelText = latestScan.riskScore > 60 ? t("scan.summary.riskScore.levels.high") : latestScan.riskScore > 30 ? t("scan.summary.riskScore.levels.med") : t("scan.summary.riskScore.levels.low");

  return (
    <Layout>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("scan.summary.riskScore.title")}
            </Text>
            <Box background={riskBackground} padding="600" borderRadius="200">
              <BlockStack gap="200" align="center">
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {latestScan.riskScore}
                </Text>
                <Text as="p" variant="bodySm">
                  / 100
                </Text>
              </BlockStack>
            </Box>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                {t("scan.summary.riskScore.level")}
              </Text>
              <Badge tone={riskBadgeTone}>
                {riskLevelText}
              </Badge>
            </InlineStack>
            {estimatedTime.totalMinutes > 0 && (
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("scan.summary.riskScore.estimatedTime")}
                </Text>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {estimatedTime.hours > 0 ? t("scan.summary.riskScore.hours", { count: estimatedTime.hours }) : ""}{estimatedTime.minutes > 0 ? t("scan.summary.riskScore.minutes", { count: estimatedTime.minutes }) : ""}
                </Text>
              </InlineStack>
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              {t("scan.summary.riskScore.scannedAt")}
              {safeFormatDate(latestScan.createdAt)}
            </Text>
            <Divider />
            <BlockStack gap="200">
              <Button
                url={isPlanAtLeast(planIdSafe, "starter") ? "/app/migrate" : "/app/billing"}
                variant={isPlanAtLeast(planIdSafe, "starter") ? "primary" : "secondary"}
                fullWidth
              >
                {isPlanAtLeast(planIdSafe, "starter")
                  ? t("scan.summary.cta.purchaseOnly")
                  : t("scan.summary.cta.upgrade")}
              </Button>
              {!isPlanAtLeast(planIdSafe, "growth") && (
                <Button
                  url="/app/billing"
                  variant="secondary"
                  fullWidth
                >
                  {t("scan.summary.cta.fullFunnel")}
                </Button>
              )}
            </BlockStack>
          </BlockStack>
        </Card>
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("scan.summary.platforms.title")}
            </Text>
            {identifiedPlatforms.length > 0 ? (
              <BlockStack gap="200">
                {identifiedPlatforms.map((platform) => (
                  <InlineStack key={platform} gap="200" align="start">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="span">{getPlatformName(platform, t)}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            ) : (
              <Text as="p" tone="subdued">
                {t("scan.summary.platforms.empty")}
              </Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {t("scan.summary.scriptTags.title")}
              </Text>
              {deprecationStatus?.scriptTag && (
                <Badge tone={deprecationStatus.scriptTag.isExpired ? "critical" : "warning"}>
                  {deprecationStatus.scriptTag.badge.text}
                </Badge>
              )}
            </InlineStack>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span">{t("scan.summary.scriptTags.count")}</Text>
                <Text as="span" fontWeight="semibold">
                  {scriptTags.length}
                </Text>
              </InlineStack>
              {scriptTags.length > 0 && deprecationStatus?.scriptTag && (
                <Banner tone={deprecationStatus.scriptTag.isExpired ? "critical" : "warning"}>
                  <Text as="p">{deprecationStatus.scriptTag.description}</Text>
                </Banner>
              )}
            </BlockStack>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}
