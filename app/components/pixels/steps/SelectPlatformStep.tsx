import { Card, BlockStack, InlineStack, Text, Badge, Button, Checkbox } from "@shopify/polaris";
import { SettingsIcon } from "~/components/icons";
import { PLATFORM_INFO, SUPPORTED_PLATFORMS, type SupportedPlatform } from "../constants";
import { useTranslation } from "react-i18next";

interface SelectPlatformStepProps {
  selectedPlatforms: Set<SupportedPlatform>;
  onPlatformToggle: (platform: SupportedPlatform, enabled: boolean) => void;
  onOpenTemplateModal: () => void;
}

export function SelectPlatformStep({
  selectedPlatforms,
  onPlatformToggle,
  onOpenTemplateModal,
}: SelectPlatformStepProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            {t("newPixelWizard.selectStep.title")}
          </Text>
          <Button size="slim" icon={SettingsIcon} onClick={onOpenTemplateModal}>
            {t("newPixelWizard.selectStep.viewTemplates")}
          </Button>
        </InlineStack>
        <Text as="p" tone="subdued">
          {t("newPixelWizard.selectStep.description")}
        </Text>
        <Card>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("newPixelWizard.selectStep.v1Support.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("newPixelWizard.selectStep.v1Support.text")}
            </Text>
          </BlockStack>
        </Card>
        <BlockStack gap="300">
          {SUPPORTED_PLATFORMS.map((platform) => {
            const info = PLATFORM_INFO[platform];
            const isSelected = selectedPlatforms.has(platform);
            return (
              <Card key={platform}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Text as="span" variant="headingLg">
                        {info.icon}
                      </Text>
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {info.name}
                          </Text>
                          <Badge tone="success" size="small">
                            {t("newPixelWizard.selectStep.v1Support.badge")}
                          </Badge>
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t(`newPixelWizard.platforms.${platform}.description`)}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <Checkbox
                      checked={isSelected}
                      onChange={(checked) => onPlatformToggle(platform, checked)}
                      label=""
                    />
                  </InlineStack>
                </BlockStack>
              </Card>
            );
          })}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
