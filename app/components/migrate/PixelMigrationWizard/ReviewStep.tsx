import { useState, useCallback } from "react";
import { BlockStack, Text, Banner, List, Card, InlineStack, Badge, Divider, Button, Modal, TextField, Checkbox } from "@shopify/polaris";
import { useSubmit } from "@remix-run/react";
import { useToastContext } from "~/components/ui";
import type { PlatformType } from "~/types/enums";
import type { PlatformConfig } from "./useWizardState";
import { PLATFORM_INFO } from "./constants";
import { ConfigVersionManager } from "../ConfigVersionManager";
import { useTranslation } from "react-i18next";

interface ReviewStepProps {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onValidate: (platform: PlatformType) => string[];
  shopId?: string;
  onEnvironmentToggle?: (platform: PlatformType, environment: "test" | "live") => void;
  pixelConfigs?: Array<{
    platform: string;
    environment: string;
    configVersion: number;
    previousConfig: unknown;
    rollbackAllowed: boolean;
  }>;
}

export function ReviewStep({
  selectedPlatforms,
  platformConfigs,
  onValidate,
  shopId,
  onEnvironmentToggle: _onEnvironmentToggle,
  pixelConfigs,
}: ReviewStepProps) {
  const { t } = useTranslation();
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const { showSuccess, showError } = useToastContext();
  const submit = useSubmit();
  const allErrors: string[] = [];
  Array.from(selectedPlatforms).forEach((platform) => {
    const errors = onValidate(platform);
    allErrors.push(...errors);
  });
  const handleSaveAsTemplate = useCallback(async () => {
    if (!shopId || !templateName.trim()) {
      showError(t("pixelMigration.review.saveTemplate.errorName"));
      return;
    }
    setIsSavingTemplate(true);
    try {
      const platforms = Array.from(selectedPlatforms);
      const eventMappings: Record<string, Record<string, string>> = {};
      platforms.forEach((platform) => {
        const config = platformConfigs[platform];
        if (config) {
          eventMappings[platform] = config.eventMappings || {};
        }
      });
      const formData = new FormData();
      formData.append("_action", "saveWizardConfigAsTemplate");
      formData.append("name", templateName.trim());
      formData.append("description", templateDescription.trim());
      formData.append("platforms", JSON.stringify(platforms));
      formData.append("eventMappings", JSON.stringify(eventMappings));
      formData.append("isPublic", isPublic ? "true" : "false");
      submit(formData, { method: "post" });
      setShowSaveTemplateModal(false);
      setTemplateName("");
      setTemplateDescription("");
      setIsPublic(false);
      showSuccess(t("pixelMigration.review.saveTemplate.success"));
    } catch (error) {
      showError(t("pixelMigration.review.saveTemplate.errorSave"));
      const { debugError } = await import("../../../utils/debug-log.client");
      debugError("[PixelMigrationWizard] Save template error:", error);
    } finally {
      setIsSavingTemplate(false);
    }
  }, [shopId, templateName, templateDescription, isPublic, selectedPlatforms, platformConfigs, submit, showSuccess, showError, t]);
  return (
    <BlockStack gap="500">
      <Text as="h3" variant="headingMd">
        {t("pixelMigration.review.title")}
      </Text>
      <Text as="p" tone="subdued">
        {t("pixelMigration.review.description")}
      </Text>
      {allErrors.length > 0 && (
        <Banner tone="critical" title={t("pixelMigration.review.configError")}>
          <List type="bullet">
            {allErrors.map((error, index) => (
              <List.Item key={index}>{error}</List.Item>
            ))}
          </List>
        </Banner>
      )}
      {Array.from(selectedPlatforms).map((platform) => {
        const config = platformConfigs[platform];
        const info = PLATFORM_INFO[platform];
        if (!config || !info) return null;
        const errors = onValidate(platform);
        return (
          <Card key={platform}>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="headingLg">
                    {info.icon}
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {info.name}
                  </Text>
                </InlineStack>
                {errors.length === 0 ? (
                  <Badge tone="success">{t("pixelMigration.review.configComplete")}</Badge>
                ) : (
                  <Badge tone="critical">{t("pixelMigration.review.configIncomplete")}</Badge>
                )}
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("pixelMigration.review.environment")}
                  </Text>
                  <Badge tone={config.environment === "live" ? "success" : "info"}>
                    {config.environment === "live" ? t("pixelMigration.credentials.liveMode") : t("pixelMigration.credentials.testMode")}
                  </Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("pixelMigration.review.platformId")}
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {config.platformId || t("pixelMigration.review.notSet")}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("pixelMigration.review.eventMapping")}
                  </Text>
                  <Text as="span" variant="bodySm">
                    {t("pixelMigration.review.eventCount", { count: Object.keys(config.eventMappings).length })}
                  </Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        );
      })}
      {shopId && Array.from(selectedPlatforms).map((platform) => {
        const existingConfig = platformConfigs[platform];
        let currentVersion = existingConfig?.configVersion;
        if (currentVersion === undefined && pixelConfigs) {
          const pixelConfig = pixelConfigs.find(
            (config: { platform: string; configVersion: number }) => config.platform === platform
          );
          currentVersion = pixelConfig?.configVersion;
        }
        currentVersion = currentVersion ?? 1;
        return (
          <ConfigVersionManager
            key={platform}
            shopId={shopId}
            platform={platform}
            currentVersion={currentVersion}
            onRollbackComplete={() => {
            }}
          />
        );
      })}
      {shopId && (
        <Card>
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              {t("pixelMigration.review.saveTemplate.title")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("pixelMigration.review.saveTemplate.description")}
            </Text>
            <Button
              size="slim"
              onClick={() => setShowSaveTemplateModal(true)}
            >
              {t("pixelMigration.review.saveTemplate.button")}
            </Button>
          </BlockStack>
        </Card>
      )}
      <Modal
        open={showSaveTemplateModal}
        onClose={() => setShowSaveTemplateModal(false)}
        title={t("pixelMigration.review.saveTemplate.modalTitle")}
        primaryAction={{
          content: t("pixelMigration.review.saveTemplate.save"),
          onAction: handleSaveAsTemplate,
          loading: isSavingTemplate,
        }}
        secondaryActions={[
          {
            content: t("pixelMigration.review.saveTemplate.cancel"),
            onAction: () => setShowSaveTemplateModal(false),
            disabled: isSavingTemplate,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label={t("pixelMigration.review.saveTemplate.nameLabel")}
              value={templateName}
              onChange={setTemplateName}
              placeholder={t("pixelMigration.review.saveTemplate.namePlaceholder")}
              helpText={t("pixelMigration.review.saveTemplate.nameHelp")}
              autoComplete="off"
            />
            <TextField
              label={t("pixelMigration.review.saveTemplate.descLabel")}
              value={templateDescription}
              onChange={setTemplateDescription}
              placeholder={t("pixelMigration.review.saveTemplate.descPlaceholder")}
              multiline={3}
              autoComplete="off"
            />
            <Checkbox
              label={t("pixelMigration.review.saveTemplate.publicLabel")}
              checked={isPublic}
              onChange={setIsPublic}
              helpText={t("pixelMigration.review.saveTemplate.publicHelp")}
            />
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                {t("pixelMigration.review.saveTemplate.configSummary")}
              </Text>
              <List type="bullet">
                <List.Item>{t("pixelMigration.review.saveTemplate.platformList", { platforms: Array.from(selectedPlatforms).map(p => PLATFORM_INFO[p]?.name || p).join(", ") })}</List.Item>
                <List.Item>{t("pixelMigration.review.saveTemplate.eventCount", { count: Array.from(selectedPlatforms).reduce((acc, p) => {
                  const config = platformConfigs[p];
                  return acc + (config?.eventMappings ? Object.keys(config.eventMappings).length : 0);
                }, 0) })}</List.Item>
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("pixelMigration.review.saveTemplate.noCredentials")}
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
