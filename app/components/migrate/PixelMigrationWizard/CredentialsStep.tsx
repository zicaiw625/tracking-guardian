import { BlockStack, Text, Card, InlineStack, Badge, Box, Divider, TextField, Select, Banner } from "@shopify/polaris";
import type { PlatformType } from "~/types/enums";
import type { PlatformConfig } from "./useWizardState";
import { PLATFORM_INFO } from "./constants";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

  return (
    <BlockStack gap="500">
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
                <BlockStack gap="200" align="end">
                  <Box
                    padding="200"
                    background={config.environment === "live" ? "bg-fill-critical" : "bg-fill-warning"}
                    borderRadius="200"
                  >
                    <Badge tone={config.environment === "live" ? "critical" : "warning"}>
                      {config.environment === "live" ? t("pixelMigration.credentials.liveMode") : t("pixelMigration.credentials.testMode")}
                    </Badge>
                  </Box>
                  <Select
                    label={t("pixelMigration.credentials.switchEnv")}
                    options={[
                      { label: t("pixelMigration.credentials.testEnvOption"), value: "test" },
                      { label: t("pixelMigration.credentials.liveEnvOption"), value: "live" },
                    ]}
                    value={config.environment}
                    onChange={(value) =>
                      onEnvironmentToggle(platform, value as "test" | "live")
                    }
                    helpText={
                      config.environment === "test"
                        ? t("pixelMigration.credentials.testEnvHelp")
                        : t("pixelMigration.credentials.liveEnvHelp")
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
                      label={t(field.label)}
                      type={field.type}
                      value={
                        config.credentials[
                          field.key as keyof typeof config.credentials
                        ] || ""
                      }
                      onChange={(value) =>
                        onCredentialUpdate(platform, field.key, value)
                      }
                      placeholder={t(field.placeholder)}
                      helpText={field.helpText ? t(field.helpText) : undefined}
                      autoComplete="off"
                    />
                  </BlockStack>
                ))}
              </BlockStack>
              {config.environment === "test" && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    {t("pixelMigration.credentials.testModeBanner")}
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
