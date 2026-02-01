import { Card, BlockStack, InlineStack, Text, Badge, Banner, Divider } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { PLATFORM_INFO, type SupportedPlatform, type PlatformConfig } from "../constants";

interface BackendUrlInfo {
  placeholderDetected?: boolean;
  isConfigured?: boolean;
}

interface ReviewStepProps {
  selectedPlatforms: Set<SupportedPlatform>;
  platformConfigs: Partial<Record<SupportedPlatform, PlatformConfig>>;
  backendUrlInfo: BackendUrlInfo | null;
}

export function ReviewStep({
  selectedPlatforms,
  platformConfigs,
  backendUrlInfo,
}: ReviewStepProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          {t("pixelMigration.review.title")}
        </Text>
        <Text as="p" tone="subdued">
          {t("pixelMigration.review.description")}
        </Text>
        {backendUrlInfo?.placeholderDetected && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.test.backendCheck.placeholder.title")}
              </Text>
              <Text as="p" variant="bodySm">
                <strong>
                  {t("pixels.test.backendCheck.placeholder.warning")}
                </strong>
                {t("pixels.test.backendCheck.placeholder.impactDesc")}
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.test.backendCheck.placeholder.fix")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("pixels.test.backendCheck.placeholder.explanation")}
              </Text>
            </BlockStack>
          </Banner>
        )}
        {!backendUrlInfo?.placeholderDetected && backendUrlInfo?.isConfigured && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.test.backendCheck.status.configured")}
              </Text>
              <Text as="p" variant="bodySm">
                {t("pixels.test.backendCheck.status.configured")}
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="warning">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("pixelMigration.sandbox.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("pixelMigration.sandbox.desc")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("pixelMigration.sandbox.reason")}
            </Text>
          </BlockStack>
        </Banner>
        {Array.from(selectedPlatforms).map((platform) => {
          const config = platformConfigs[platform];
          const info = PLATFORM_INFO[platform];
          if (!config || !info) return null;
          return (
            <Card key={platform}>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="headingLg">
                      {info.icon}
                    </Text>
                    <Text as="span" fontWeight="semibold">
                      {info.name}
                    </Text>
                  </InlineStack>
                  <Badge tone={config.environment === "live" ? "critical" : "warning"}>
                    {config.environment === "live" ? t("pixelMigration.credentials.liveMode") : t("pixelMigration.credentials.testMode")}
                  </Badge>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    {t("pixelMigration.review.platformId")}
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {config.platformId || t("pixelMigration.review.notSet")}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    {t("pixelMigration.review.eventMapping")}
                  </Text>
                  <Text as="span">
                    {t("pixelMigration.review.eventCount", { count: Object.keys(config.eventMappings || {}).length })}
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>
    </Card>
  );
}
