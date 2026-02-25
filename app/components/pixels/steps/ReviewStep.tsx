import { Card, BlockStack, InlineStack, Text, Badge, Banner, Divider } from "@shopify/polaris";
import { PLATFORM_INFO, type SupportedPlatform, type PlatformConfig } from "../constants";
import { useTranslation, Trans } from "react-i18next";

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
          {t("newPixelWizard.reviewStep.title")}
        </Text>
        <Text as="p" tone="subdued">
          {t("newPixelWizard.reviewStep.description")}
        </Text>
        {backendUrlInfo?.placeholderDetected && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("newPixelWizard.reviewStep.placeholderError.title")}
              </Text>
              <Text as="p" variant="bodySm">
                <Trans i18nKey="newPixelWizard.reviewStep.placeholderError.description" components={{ strong: <strong /> }} />
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("newPixelWizard.reviewStep.placeholderError.fixSteps")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("newPixelWizard.reviewStep.placeholderError.hint")}
              </Text>
            </BlockStack>
          </Banner>
        )}
        {!backendUrlInfo?.placeholderDetected && backendUrlInfo?.isConfigured && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("newPixelWizard.reviewStep.configuredSuccess.title")}
              </Text>
              <Text as="p" variant="bodySm">
                <Trans i18nKey="newPixelWizard.reviewStep.configuredSuccess.description" components={{ code: <code /> }} />
              </Text>
              <Text as="p" variant="bodySm">
                <Trans i18nKey="newPixelWizard.reviewStep.configuredSuccess.important" components={{ strong: <strong /> }} />
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="warning">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("newPixelWizard.reviewStep.sandboxInfo.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("newPixelWizard.reviewStep.sandboxInfo.description")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("newPixelWizard.reviewStep.sandboxInfo.hint")}
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
                      {t(info.nameKey, { defaultValue: platform })}
                    </Text>
                  </InlineStack>
                  <Badge tone={config.environment === "live" ? "critical" : "warning"}>
                    {config.environment === "live" ? t("newPixelWizard.reviewStep.production") : t("newPixelWizard.reviewStep.test")}
                  </Badge>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    {t("newPixelWizard.reviewStep.platformId")}
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {config.platformId || t("newPixelWizard.reviewStep.notFilled")}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    {t("newPixelWizard.reviewStep.eventMappings")}
                  </Text>
                  <Text as="span">
                    {t("newPixelWizard.reviewStep.eventCount", { count: Object.keys(config.eventMappings || {}).length })}
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
