import { BlockStack, Text, Card, InlineStack, Badge, Box, Divider, TextField, Select, Banner } from "@shopify/polaris";
import type { PlatformType } from "~/types/enums";
import type { PlatformConfig } from "./useWizardState";
import { PLATFORM_INFO } from "./constants";

interface CredentialsStepProps {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onCredentialUpdate: (platform: PlatformType, field: string, value: string) => void;
  onEnvironmentToggle: (platform: PlatformType, environment: "test" | "live") => void;
}

export function CredentialsStep({
  selectedPlatforms,
  platformConfigs,
  onCredentialUpdate,
  onEnvironmentToggle,
}: CredentialsStepProps) {
  return (
    <BlockStack gap="500">
      <Text as="h3" variant="headingMd">
        填写平台凭证
      </Text>
      <Text as="p" tone="subdued">
        为每个选中的平台填写 API 凭证。这些凭证将加密存储，用于后续能力规划；当前版本默认不进行服务端投递。
      </Text>
      {Array.from(selectedPlatforms).map((platform) => {
        const config = platformConfigs[platform];
        const info = PLATFORM_INFO[platform];
        if (!config || !info) return null;
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
                <BlockStack gap="200" align="end">
                  <Box
                    padding="200"
                    background={config.environment === "live" ? "bg-fill-critical" : "bg-fill-warning"}
                    borderRadius="200"
                  >
                    <Badge tone={config.environment === "live" ? "critical" : "warning"}>
                      {config.environment === "live" ? "🔴 生产模式" : "🟡 测试模式"}
                    </Badge>
                  </Box>
                  <Select
                    label="切换环境"
                    options={[
                      { label: "🟡 测试环境 (Test) - 用于验证配置", value: "test" },
                      { label: "🔴 生产环境 (Live)", value: "live" },
                    ]}
                    value={config.environment}
                    onChange={(value) => onEnvironmentToggle(platform, value as "test" | "live")}
                    helpText={
                      config.environment === "test"
                        ? "测试模式：用于验证映射与验收"
                        : "生产模式：用于生产环境验收与监控"
                    }
                  />
                </BlockStack>
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                {info.credentialFields.map((field) => (
                  <BlockStack key={field.key} gap="100">
                    <TextField
                      key={field.key}
                      label={field.label}
                      type={field.type}
                      value={config.credentials[field.key as keyof typeof config.credentials] || ""}
                      onChange={(value) => onCredentialUpdate(platform, field.key, value)}
                      placeholder={field.placeholder}
                      helpText={field.helpText}
                      autoComplete="off"
                    />
                  </BlockStack>
                ))}
              </BlockStack>
              {config.environment === "test" && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    测试模式下，事件将发送到平台的测试端点，不会影响实际广告数据。
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        );
      })}
    </BlockStack>
  );
}
