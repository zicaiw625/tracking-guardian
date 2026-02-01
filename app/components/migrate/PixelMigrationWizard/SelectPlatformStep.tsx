import { BlockStack, Text, Banner, Button, Card, Checkbox, InlineStack, Badge, Divider, Modal } from "@shopify/polaris";
import { SettingsIcon } from "~/components/icons";
import type { PlatformType } from "~/types/enums";
import type { PlatformConfig } from "./useWizardState";
import type { WizardTemplate } from "../PixelMigrationWizard";
import { PLATFORM_INFO } from "./constants";
import { isV1SupportedPlatform } from "~/utils/v1-platforms";
import { useTranslation, Trans } from "react-i18next";

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
        {t("pixelMigration.selectPlatform.title")}
      </Text>
      <Text as="p" tone="subdued">
        {t("pixelMigration.selectPlatform.description")}
      </Text>
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            {t("pixelMigration.selectPlatform.templateTip")}
          </Text>
          <Button
            size="slim"
            onClick={() => onShowTemplateModal(true)}
            icon={SettingsIcon}
          >
            {t("pixelMigration.selectPlatform.viewTemplates")}
          </Button>
        </BlockStack>
      </Banner>
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            {t("pixelMigration.selectPlatform.v1Capabilities.title")}
          </Text>
          <Text as="p" variant="bodySm">
            • <Trans i18nKey="pixelMigration.selectPlatform.v1Capabilities.mapping" components={{ strong: <strong /> }} />
          </Text>
          <Text as="p" variant="bodySm">
            • <Trans i18nKey="pixelMigration.selectPlatform.v1Capabilities.paramsCheck" components={{ strong: <strong /> }} />
          </Text>
          <Text as="p" variant="bodySm">
            • <Trans i18nKey="pixelMigration.selectPlatform.v1Capabilities.payloadEvidence" components={{ strong: <strong /> }} />
          </Text>
          <Text as="p" variant="bodySm">
            • <Trans i18nKey="pixelMigration.selectPlatform.v1Capabilities.supportedPlatforms" components={{ strong: <strong /> }} />
          </Text>
          <Text as="p" variant="bodySm">
            • <Trans i18nKey="pixelMigration.selectPlatform.v1Capabilities.roadmap" components={{ strong: <strong /> }} />
          </Text>
          <Divider />
          <Text as="p" variant="bodySm" fontWeight="semibold">
            {t("pixelMigration.selectPlatform.techLimitations.title")}
          </Text>
          <Text as="p" variant="bodySm">
            {t("pixelMigration.selectPlatform.techLimitations.content")}
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
                          {info.name}
                        </Text>
                        {isV1Supported && (
                          <Badge tone="success" size="small">{t("pixelMigration.selectPlatform.v1Support")}</Badge>
                        )}
                        {!isV1Supported && (
                          <Badge tone="info" size="small">{t("pixelMigration.selectPlatform.v1Plus")}</Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {info.description}
                        {!isV1Supported && t("pixelMigration.selectPlatform.comingSoon")}
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
                      {t("pixelMigration.selectPlatform.v1Focus")}
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
        title={t("pixelMigration.selectPlatform.modalTitle")}
        primaryAction={{
          content: t("common.close", "Close"),
          onAction: () => onShowTemplateModal(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              {t("pixelMigration.selectPlatform.modalDesc")}
            </Text>
            {templates.map((template) => (
              <Card key={template.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {t(template.name)}
                        </Text>
                        {template.isPublic && (
                          <Badge tone="info">{t("pixelMigration.selectPlatform.public")}</Badge>
                        )}
                        {template.usageCount > 0 && (
                          <Badge>{t("pixelMigration.selectPlatform.usageCount", { count: template.usageCount })}</Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t(template.description)}
                      </Text>
                    </BlockStack>
                    <Button
                      size="slim"
                      onClick={() => onApplyTemplate(template)}
                    >
                      {t("pixelMigration.selectPlatform.apply")}
                    </Button>
                  </InlineStack>
                  <InlineStack gap="100">
                    {template.platforms.map((p) => {
                      const platformKey = p as PlatformType;
                      return (
                        <Badge key={p}>
                          {PLATFORM_INFO[platformKey]?.name || p}
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
