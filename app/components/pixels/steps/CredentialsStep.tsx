import { Card, BlockStack, Text } from "@shopify/polaris";
import { PLATFORM_INFO, type SupportedPlatform, type PlatformConfig } from "../constants";
import {
  PlatformCredentialsForm,
  getEmptyCredentials,
  type PlatformCredentials,
  type GoogleCredentials,
  type MetaCredentials,
  type TikTokCredentials,
} from "~/components/forms/PlatformCredentialsForm";
import { useTranslation } from "react-i18next";

interface CredentialsStepProps {
  selectedPlatforms: Set<SupportedPlatform>;
  platformConfigs: Partial<Record<SupportedPlatform, PlatformConfig>>;
  onCredentialsChange: (platform: SupportedPlatform, credentials: Record<string, string>) => void;
}

function toFormValues(platform: SupportedPlatform, credentials: Record<string, string>): PlatformCredentials {
  const empty = getEmptyCredentials(platform);
  if (platform === "google") {
    const e = empty as GoogleCredentials;
    return {
      measurementId: credentials.measurementId ?? e.measurementId,
      apiSecret: credentials.apiSecret ?? e.apiSecret,
    };
  }
  if (platform === "meta") {
    const e = empty as MetaCredentials;
    return {
      pixelId: credentials.pixelId ?? e.pixelId,
      accessToken: credentials.accessToken ?? e.accessToken,
      testEventCode: credentials.testEventCode ?? e.testEventCode,
    };
  }
  const e = empty as TikTokCredentials;
  return {
    pixelId: credentials.pixelId ?? e.pixelId,
    accessToken: credentials.accessToken ?? e.accessToken,
  };
}

function fromFormValues(platform: SupportedPlatform, values: PlatformCredentials): Record<string, string> {
  if (platform === "google") {
    const v = values as { measurementId: string; apiSecret: string };
    return { measurementId: v.measurementId ?? "", apiSecret: v.apiSecret ?? "" };
  }
  if (platform === "meta") {
    const v = values as { pixelId: string; accessToken: string; testEventCode?: string };
    const out: Record<string, string> = { pixelId: v.pixelId ?? "", accessToken: v.accessToken ?? "" };
    if (v.testEventCode) out.testEventCode = v.testEventCode;
    return out;
  }
  const v = values as { pixelId: string; accessToken: string };
  return { pixelId: v.pixelId ?? "", accessToken: v.accessToken ?? "" };
}

export function CredentialsStep({
  selectedPlatforms,
  platformConfigs,
  onCredentialsChange,
}: CredentialsStepProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          {t("newPixelWizard.credentialsStep.title")}
        </Text>
        <Text as="p" tone="subdued">
          {t("newPixelWizard.credentialsStep.description")}
        </Text>
        {Array.from(selectedPlatforms).map((platform) => {
          const config = platformConfigs[platform];
          const info = PLATFORM_INFO[platform];
          if (!config || !info) return null;
          const formValues = toFormValues(platform, config.credentials ?? {});
          return (
            <Card key={platform}>
              <BlockStack gap="300">
                <Text as="span" fontWeight="semibold">
                  {info.icon} {info.name}
                </Text>
                <PlatformCredentialsForm
                  platform={platform}
                  values={formValues}
                  onChange={(values) => onCredentialsChange(platform, fromFormValues(platform, values))}
                />
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>
    </Card>
  );
}
