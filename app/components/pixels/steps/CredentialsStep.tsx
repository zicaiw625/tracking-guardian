import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  TextField,
  Banner,
  Select,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { PLATFORM_INFO, type SupportedPlatform, type PlatformConfig } from "../constants";

interface CredentialsStepProps {
  selectedPlatforms: Set<SupportedPlatform>;
  platformConfigs: Partial<Record<SupportedPlatform, PlatformConfig>>;
  onChange: (configs: Partial<Record<SupportedPlatform, PlatformConfig>>) => void;
}

export function CredentialsStep({
  selectedPlatforms,
  platformConfigs,
  onChange,
}: CredentialsStepProps) {
  const { t } = useTranslation();

  const handleCredentialChange = (
    platform: SupportedPlatform,
    key: string,
    value: string
  ) => {
    const currentConfig = platformConfigs[platform];
    if (!currentConfig) return;

    onChange({
      ...platformConfigs,
      [platform]: {
        ...currentConfig,
        credentials: {
          ...currentConfig.credentials,
          [key]: value,
        },
      },
    });
  };

  const handleEnvironmentChange = (
    platform: SupportedPlatform,
    environment: "test" | "live"
  ) => {
    const currentConfig = platformConfigs[platform];
    if (!currentConfig) return;

    onChange({
      ...platformConfigs,
      [platform]: {
        ...currentConfig,
        environment,
      },
    });
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          {t("pixelMigration.credentials.title")}
        </Text>
        <Text as="p" tone="subdued">
          {t("pixelMigration.credentials.description")}
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
                  <Badge tone={config.environment === "live" ? "critical" : "warning"}>
                    {config.environment === "live" ? t("pixelMigration.credentials.liveMode") : t("pixelMigration.credentials.testMode")}
                  </Badge>
                </InlineStack>
                
                <Select
                  label={t("pixelMigration.credentials.switchEnv")}
                  options={[
                    { label: t("pixelMigration.credentials.testEnvOption"), value: "test" },
                    { label: t("pixelMigration.credentials.liveEnvOption"), value: "live" },
                  ]}
                  value={config.environment}
                  onChange={(value) => handleEnvironmentChange(platform, value as "test" | "live")}
                  helpText={
                    config.environment === "test" 
                      ? t("pixelMigration.credentials.testEnvHelp")
                      : t("pixelMigration.credentials.liveEnvHelp")
                  }
                />

                {config.environment === "test" && (
                  <Banner tone="warning">
                    {t("pixelMigration.credentials.testModeBanner")}
                  </Banner>
                )}

                <BlockStack gap="300">
                  {info.credentialFields.map((field) => (
                    <TextField
                      key={field.key}
                      label={t(field.labelKey)}
                      value={config.credentials?.[field.key] || ""}
                      onChange={(value) => handleCredentialChange(platform, field.key, value)}
                      placeholder={t(field.placeholderKey)}
                      type={field.type}
                      autoComplete="off"
                      helpText={field.helpTextKey ? t(field.helpTextKey) : undefined}
                    />
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>
    </Card>
  );
}
