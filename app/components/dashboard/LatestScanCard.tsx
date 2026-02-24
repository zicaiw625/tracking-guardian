import { memo } from "react";
import { Card, BlockStack, InlineStack, Text, Box, Badge, Button } from "@shopify/polaris";
import { EnhancedEmptyState } from "~/components/ui";
import { useTranslation } from "react-i18next";

type SerializedLatestScan = {
  status: string;
  riskScore: number;
  createdAt: string | Date;
  identifiedPlatforms: string[];
} | null;

export const LatestScanCard = memo(function LatestScanCard({ latestScan }: { latestScan: SerializedLatestScan }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  if (!latestScan) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("dashboard.latestScan.title")}
          </Text>
          <EnhancedEmptyState
            icon="🔍"
            title={t("dashboard.latestScan.emptyTitle")}
            description={t("dashboard.latestScan.emptyDesc")}
            primaryAction={{
              content: t("dashboard.latestScan.startScan"),
              url: "/app/scan",
            }}
          />
        </BlockStack>
      </Card>
    );
  }
  const riskLevel =
    latestScan.riskScore >= 70
      ? { level: t("dashboard.latestScan.riskHigh"), tone: "critical" as const }
      : latestScan.riskScore >= 40
        ? { level: t("dashboard.latestScan.riskMedium"), tone: "warning" as const }
        : { level: t("dashboard.latestScan.riskLow"), tone: "success" as const };
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            {t("dashboard.latestScan.title")}
          </Text>
          <Badge tone={riskLevel.tone} size="large">
            {riskLevel.level}
          </Badge>
        </InlineStack>
        <Box
          background={
            latestScan.riskScore >= 70
              ? "bg-fill-critical"
              : latestScan.riskScore >= 40
                ? "bg-fill-warning"
                : "bg-fill-success"
          }
          padding="500"
          borderRadius="200"
        >
          <BlockStack gap="200" align="center">
            <Text as="p" variant="heading2xl" fontWeight="bold">
              {latestScan.riskScore}
            </Text>
            <Text as="p" variant="bodySm">
              / 100
            </Text>
          </BlockStack>
        </Box>
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" tone="subdued">
            {t("dashboard.latestScan.scannedAt")} {new Date(latestScan.createdAt).toLocaleDateString(locale)}
          </Text>
          {latestScan.identifiedPlatforms.length > 0 ? (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("dashboard.latestScan.identifiedPlatforms")}
              </Text>
              <InlineStack gap="100" wrap>
                {latestScan.identifiedPlatforms.map((platform) => (
                  <Badge key={platform}>{platform}</Badge>
                ))}
              </InlineStack>
            </BlockStack>
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">
              {t("dashboard.latestScan.noPlatforms")}
            </Text>
          )}
        </BlockStack>
        <Button url="/app/scan?tab=2" fullWidth>
          {t("dashboard.latestScan.viewReport")}
        </Button>
      </BlockStack>
    </Card>
  );
});
