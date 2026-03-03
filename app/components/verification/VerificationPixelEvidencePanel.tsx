import { Badge, BlockStack, Card, InlineStack, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

type RecentReceipt = {
  id: string;
  platform: string;
  eventType: string;
  pixelTimestamp: string;
  totalValue: number | null;
  currency: string | null;
  hmacMatched: boolean;
  trustLevel: string;
};

interface VerificationPixelEvidencePanelProps {
  latestRun: {
    totalTests?: number;
    parameterCompleteness?: number;
    valueAccuracy?: number;
  } | null;
  recentReceipts: RecentReceipt[];
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${Math.round(value)}%`;
}

export function VerificationPixelEvidencePanel({
  latestRun,
  recentReceipts,
}: VerificationPixelEvidencePanelProps) {
  const { t } = useTranslation();
  const hasRunMetrics = !!latestRun && (latestRun.totalTests ?? 0) > 0;
  const hmacMatchedCount = recentReceipts.filter((item) => item.hmacMatched).length;
  const hmacMatchRate = recentReceipts.length > 0 ? hmacMatchedCount / recentReceipts.length : 0;
  const currencyMissingCount = recentReceipts.filter((item) => !item.currency).length;
  const valueMissingCount = recentReceipts.filter((item) => item.totalValue === null).length;

  return (
    <BlockStack gap="400">
      <InlineStack gap="400" align="space-between">
        <Card>
          <BlockStack gap="150">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("verification.page.pixelLayer.metrics.completeness")}
            </Text>
            <Text as="p" variant="headingLg">
              {hasRunMetrics ? formatPercent(latestRun?.parameterCompleteness) : "-"}
            </Text>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="150">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("verification.page.pixelLayer.metrics.accuracy")}
            </Text>
            <Text as="p" variant="headingLg">
              {hasRunMetrics ? formatPercent(latestRun?.valueAccuracy) : "-"}
            </Text>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="150">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("verification.page.pixelLayer.metrics.receipts")}
            </Text>
            <Text as="p" variant="headingLg">
              {recentReceipts.length}
            </Text>
          </BlockStack>
        </Card>
      </InlineStack>

      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            {t("verification.page.pixelLayer.health.title")}
          </Text>
          <InlineStack gap="200" wrap>
            <Badge tone={recentReceipts.length > 0 ? "success" : "warning"}>
              {t("verification.page.pixelLayer.health.receipts", { count: recentReceipts.length })}
            </Badge>
            <Badge tone={hmacMatchRate >= 0.9 ? "success" : hmacMatchRate >= 0.6 ? "warning" : "critical"}>
              {t("verification.page.pixelLayer.health.hmac", { count: hmacMatchedCount })}
            </Badge>
            <Badge tone={currencyMissingCount === 0 ? "success" : "warning"}>
              {t("verification.page.pixelLayer.health.currencyMissing", { count: currencyMissingCount })}
            </Badge>
            <Badge tone={valueMissingCount === 0 ? "success" : "warning"}>
              {t("verification.page.pixelLayer.health.valueMissing", { count: valueMissingCount })}
            </Badge>
          </InlineStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm">
              {t("verification.page.pixelLayer.receipts.title")}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {t("verification.page.pixelLayer.receipts.caption")}
            </Text>
          </InlineStack>
          {recentReceipts.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {t("verification.page.pixelLayer.receipts.empty")}
            </Text>
          ) : (
            recentReceipts.slice(0, 12).map((item) => (
              <InlineStack key={item.id} align="space-between">
                <Text as="span" variant="bodySm">
                  {item.platform} / {item.eventType}
                </Text>
                <InlineStack gap="200">
                  <Text as="span" variant="bodySm" tone={item.hmacMatched ? "success" : "critical"}>
                    {item.hmacMatched
                      ? t("verification.page.pixelLayer.receipts.hmacMatched")
                      : t("verification.page.pixelLayer.receipts.hmacMismatched")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {new Date(item.pixelTimestamp).toLocaleString()}
                  </Text>
                </InlineStack>
              </InlineStack>
            ))
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
