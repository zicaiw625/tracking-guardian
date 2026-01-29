import { Card, BlockStack, InlineStack, Text, Badge, Banner, Divider } from "@shopify/polaris";
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
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          检查配置
        </Text>
        <Text as="p" tone="subdued">
          确认平台、凭证与事件映射无误后保存配置。
        </Text>
        {backendUrlInfo?.placeholderDetected && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ⚠️ 严重错误：检测到占位符，URL 未在构建时替换
              </Text>
              <Text as="p" variant="bodySm">
                <strong>
                  像素扩展配置中仍包含 __BACKEND_URL_PLACEHOLDER__，这表明构建流程未正确替换占位符。</strong>
                如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。这是一个严重的配置错误，必须在上线前修复。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                修复步骤（必须在生产环境部署前完成）：
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                💡 提示：如果占位符未被替换，像素扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。
              </Text>
            </BlockStack>
          </Banner>
        )}
        {!backendUrlInfo?.placeholderDetected && backendUrlInfo?.isConfigured && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ✅ BACKEND_URL 已正确配置
              </Text>
              <Text as="p" variant="bodySm">
                扩展的 BACKEND_URL 已正确注入。生产环境部署时，请确保始终使用{" "}
                <code>pnpm deploy:ext</code> 命令，该命令会自动执行{" "}
                <code>pnpm ext:inject</code> 注入 BACKEND_URL。禁止直接使用{" "}
                <code>shopify app deploy</code>。
              </Text>
              <Text as="p" variant="bodySm">
                <strong>重要：扩展的 BACKEND_URL 注入是生命线。</strong>
                如果占位符未被替换，像素扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="warning">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              ⚠️ Strict Sandbox 能力边界说明（App Review 重要信息）
            </Text>
            <Text as="p" variant="bodySm">
              Web Pixel 运行在 strict sandbox (Web Worker) 环境中，以下能力受限：
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              💡 提示：这是 Shopify 平台的设计限制，不是应用故障。验收报告中会自动标注所有因 strict
              sandbox 限制而无法获取的字段和事件。在 App Review 时，请向 Shopify 说明这些限制是平台设计，不是应用缺陷。
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
                    {config.environment === "live" ? "生产" : "测试"}
                  </Badge>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    平台 ID
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {config.platformId || "未填写"}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    事件映射
                  </Text>
                  <Text as="span">
                    {Object.keys(config.eventMappings || {}).length} 个事件
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
