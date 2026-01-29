import { BlockStack, Text, Banner, Button, Card, Checkbox, InlineStack, Badge, Divider, Modal } from "@shopify/polaris";
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
  return (
    <BlockStack gap="400">
      <Text as="h3" variant="headingMd">
        选择要配置的平台
      </Text>
      <Text as="p" tone="subdued">
        选择您要迁移的广告平台。您可以稍后在设置页面添加更多平台。
      </Text>
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            提示：您可以使用预设模板快速配置多个平台，或手动选择平台。
          </Text>
          <Button
            size="slim"
            onClick={() => onShowTemplateModal(true)}
            icon={SettingsIcon}
          >
            查看预设模板
          </Button>
        </BlockStack>
      </Banner>
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            v1 像素迁移核心能力：
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>标准事件映射</strong>：Shopify 事件 → 平台事件（GA4/Meta/TikTok）
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>参数完整率检查</strong>：自动验证事件参数是否完整
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>可下载 payload 证据</strong>：用于验证和存档（Test/Live 环境）
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>v1 支持平台</strong>：GA4、Meta、TikTok（三选一，Migration $49/月）
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>v1.1+ 规划</strong>：Pinterest、Snapchat 等其他平台将在后续版本支持
          </Text>
          <Divider />
          <Text as="p" variant="bodySm" fontWeight="semibold">
            ⚠️ 技术限制说明：
          </Text>
          <Text as="p" variant="bodySm">
            Web Pixel 运行在 strict sandbox（Web Worker）环境中，很多能力受限（如 DOM 访问、第三方 cookie、localStorage 等）。部分原有脚本功能可能无法完全迁移。
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
                          <Badge tone="success" size="small">v1 支持</Badge>
                        )}
                        {!isV1Supported && (
                          <Badge tone="info" size="small">v1.1+</Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {info.description}
                        {!isV1Supported && "（v1.1+ 版本将支持）"}
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
                      该平台将在 v1.1+ 版本支持。v1 专注于 GA4、Meta、TikTok 的最小可用迁移。
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
        title="选择预设模板"
        primaryAction={{
          content: "关闭",
          onAction: () => onShowTemplateModal(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              选择一个预设模板快速配置多个平台的事件映射。
            </Text>
            {templates.map((template) => (
              <Card key={template.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {template.name}
                        </Text>
                        {template.isPublic && (
                          <Badge tone="info">公开</Badge>
                        )}
                        {template.usageCount > 0 && (
                          <Badge>{`使用 ${String(template.usageCount)} 次`}</Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {template.description}
                      </Text>
                    </BlockStack>
                    <Button
                      size="slim"
                      onClick={() => onApplyTemplate(template)}
                    >
                      应用
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
