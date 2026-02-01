import { useState, useCallback } from "react";
import { BlockStack, Text, Banner, List, Card, InlineStack, Badge, Divider, Button, Modal, TextField, Checkbox } from "@shopify/polaris";
import { useSubmit } from "@remix-run/react";
import { useToastContext } from "~/components/ui";
import type { PlatformType } from "~/types/enums";
import type { PlatformConfig } from "./useWizardState";
import { PLATFORM_INFO } from "./constants";
import { ConfigVersionManager } from "../ConfigVersionManager";

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
      showError("请输入模板名称");
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
      showSuccess("模板已保存！");
    } catch (error) {
      showError("保存模板失败");
      const { debugError } = await import("../../../utils/debug-log.client");
      debugError("[PixelMigrationWizard] Save template error:", error);
    } finally {
      setIsSavingTemplate(false);
    }
  }, [shopId, templateName, templateDescription, isPublic, selectedPlatforms, platformConfigs, submit, showSuccess, showError]);
  return (
    <BlockStack gap="500">
      <Text as="h3" variant="headingMd">
        检查配置
      </Text>
      <Text as="p" tone="subdued">
        请检查以下配置是否正确。确认无误后点击「保存配置」。您也可以将当前配置保存为模板，方便后续使用。
      </Text>
      {allErrors.length > 0 && (
        <Banner tone="critical" title="配置错误">
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
                  <Badge tone="success">配置完整</Badge>
                ) : (
                  <Badge tone="critical">配置不完整</Badge>
                )}
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    环境
                  </Text>
                  <Badge tone={config.environment === "live" ? "success" : "info"}>
                    {config.environment === "live" ? "生产模式" : "测试模式"}
                  </Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    平台 ID
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {config.platformId || "未填写"}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    事件映射
                  </Text>
                  <Text as="span" variant="bodySm">
                    {Object.keys(config.eventMappings).length} 个事件
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
              保存为模板
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              将当前配置保存为模板，方便后续快速应用到其他店铺或分享给团队成员。
            </Text>
            <Button
              size="slim"
              onClick={() => setShowSaveTemplateModal(true)}
            >
              保存为模板
            </Button>
          </BlockStack>
        </Card>
      )}
      <Modal
        open={showSaveTemplateModal}
        onClose={() => setShowSaveTemplateModal(false)}
        title="保存为模板"
        primaryAction={{
          content: "保存",
          onAction: handleSaveAsTemplate,
          loading: isSavingTemplate,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setShowSaveTemplateModal(false),
            disabled: isSavingTemplate,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="模板名称"
              value={templateName}
              onChange={setTemplateName}
              placeholder="例如：标准电商配置"
              helpText="为模板起一个易于识别的名称"
              autoComplete="off"
            />
            <TextField
              label="模板描述"
              value={templateDescription}
              onChange={setTemplateDescription}
              placeholder="描述这个模板的用途和适用场景"
              multiline={3}
              autoComplete="off"
            />
            <Checkbox
              label="公开模板"
              checked={isPublic}
              onChange={setIsPublic}
              helpText="公开模板可以被其他用户查看和使用，适合分享最佳实践"
            />
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                模板将保存以下配置：
              </Text>
              <List type="bullet">
                <List.Item>平台：{Array.from(selectedPlatforms).map(p => PLATFORM_INFO[p]?.name || p).join(", ")}</List.Item>
                <List.Item>事件映射：{Array.from(selectedPlatforms).reduce((acc, p) => {
                  const config = platformConfigs[p];
                  return acc + (config?.eventMappings ? Object.keys(config.eventMappings).length : 0);
                }, 0)} 个事件</List.Item>
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                注意：模板不会保存凭证信息，仅保存事件映射配置。
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
