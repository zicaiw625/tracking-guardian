import { BlockStack, Text, Banner, Button, Card, Checkbox, InlineStack, Badge, Divider, Modal } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { SettingsIcon } from "~/components/icons";
import type { PlatformType } from "~/types/enums";
import type { PlatformConfig } from "./useWizardState";
import type { WizardTemplate } from "../PixelMigrationWizard";
import { PLATFORM_INFO } from "./constants";
import { isV1SupportedPlatform } from "~/utils/v1-platforms";

interface SelectPlatformStepProps {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onPlatformToggle: (platform: PlatformType, enabled: boolean) => void;
  onApplyTemplate: (template: WizardTemplate) => void;
  showTemplateModal: boolean;
  onShowTemplateModal: (show: boolean) => void;
  templates: WizardTemplate[];
}

export function SelectPlatformStep({
  selectedPlatforms,
  platformConfigs: _platformConfigs,
  onPlatformToggle,
  onApplyTemplate,
  showTemplateModal,
  onShowTemplateModal,
  templates,
}: SelectPlatformStepProps) {
  const { t } = useTranslation();
  return (
    <BlockStack gap="400">
      <Text as="h3" variant="headingMd">
        {t("selectPlatformStep.title")}
      </Text>
      <Text as="p" tone="subdued">
        {t("selectPlatformStep.description")}
      </Text>
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            {t("selectPlatformStep.templateTip")}
          </Text>
          <Button
            size="slim"
            onClick={() => onShowTemplateModal(true)}
            icon={SettingsIcon}
          >
            {t("selectPlatformStep.viewTemplates")}
          </Button>
        </BlockStack>
      </Banner>
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            {t("selectPlatformStep.coreCapabilities")}
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>{t("selectPlatformStep.standardEventMapping")}</strong>{t("selectPlatformStep.standardEventMappingDesc")}
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>{t("selectPlatformStep.paramCompletenessCheck")}</strong>{t("selectPlatformStep.paramCompletenessCheckDesc")}
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>{t("selectPlatformStep.downloadablePayload")}</strong>{t("selectPlatformStep.downloadablePayloadDesc")}
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>{t("selectPlatformStep.v1SupportedPlatforms")}</strong>{t("selectPlatformStep.v1SupportedPlatformsDesc")}
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>{t("selectPlatformStep.v1_1Planning")}</strong>{t("selectPlatformStep.v1_1PlanningDesc")}
          </Text>
          <Divider />
          <Text as="p" variant="bodySm" fontWeight="semibold">
            {t("selectPlatformStep.techLimitations")}
          </Text>
          <Text as="p" variant="bodySm">
            {t("selectPlatformStep.techLimitationsDetail")}
          </Text>
        </BlockStack>
      </Banner>
      <BlockStack gap="300">
        {(Object.keys(PLATFORM_INFO) as PlatformType[]).filter((platform) => {
          return isV1SupportedPlatform(platform);
        }).map((platform) => {
          const info = PLATFORM_INFO[platform];
          if (!info) return null;
          const isSelected = selectedPlatforms.has(platform);
          const isV1Supported = isV1SupportedPlatform(platform);
          const isDisabled = !isV1Supported;
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
                          {t(info.nameKey, { defaultValue: platform })}
                        </Text>
                        {isV1Supported && (
                          <Badge tone="success" size="small">{t("selectPlatformStep.v1Supported")}</Badge>
                        )}
                        {!isV1Supported && (
                          <Badge tone="info" size="small">v1.1+</Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t(info.descriptionKey, { defaultValue: platform })}
                        {!isV1Supported && t("selectPlatformStep.futureVersionSupport")}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Checkbox
                    checked={isSelected}
                    onChange={(checked) => {
                      if (!isDisabled) {
                        onPlatformToggle(platform, checked);
                      }
                    }}
                    disabled={isDisabled}
                    label=""
                  />
                </InlineStack>
                {isDisabled && (
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      {t("selectPlatformStep.platformUnavailable")}
                    </Text>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>
      <Modal
        open={showTemplateModal}
        onClose={() => onShowTemplateModal(false)}
        title={t("selectPlatformStep.selectTemplate")}
        primaryAction={{
          content: t("selectPlatformStep.close"),
          onAction: () => onShowTemplateModal(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              {t("selectPlatformStep.templateSelectDesc")}
            </Text>
            {templates.map((template) => (
              <Card key={template.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {template.id === "standard"
                            ? t("pixelWizard.templates.presets.standard.name")
                            : template.id === "advanced"
                            ? t("pixelWizard.templates.presets.advanced.name")
                            : template.name}
                        </Text>
                        {template.isPublic && (
                          <Badge tone="info">{t("selectPlatformStep.public")}</Badge>
                        )}
                        {template.usageCount > 0 && (
                          <Badge>{t("selectPlatformStep.usageCount", { count: template.usageCount })}</Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {template.id === "standard"
                          ? t("pixelWizard.templates.presets.standard.description")
                          : template.id === "advanced"
                          ? t("pixelWizard.templates.presets.advanced.description")
                          : template.description}
                      </Text>
                    </BlockStack>
                    <Button
                      size="slim"
                      onClick={() => onApplyTemplate(template)}
                    >
                      {t("selectPlatformStep.apply")}
                    </Button>
                  </InlineStack>
                  <InlineStack gap="100">
                    {template.platforms.map((p) => {
                      const platformKey = p as PlatformType;
                      return (
                        <Badge key={p}>
                          {PLATFORM_INFO[platformKey]?.nameKey
                            ? t(PLATFORM_INFO[platformKey].nameKey, { defaultValue: p })
                            : p}
                        </Badge>
                      );
                    })}
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
