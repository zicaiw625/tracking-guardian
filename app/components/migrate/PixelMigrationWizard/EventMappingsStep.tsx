import { BlockStack, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import type { PlatformType } from "~/types/enums";
import type { PlatformConfig } from "./useWizardState";
import { EventMappingEditor } from "../EventMappingEditor";

interface EventMappingsStepProps {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onEventMappingUpdate: (
    platform: PlatformType,
    shopifyEvent: string,
    platformEvent: string
  ) => void;
}

export function EventMappingsStep({
  selectedPlatforms,
  platformConfigs,
  onEventMappingUpdate,
}: EventMappingsStepProps) {
  const { t } = useTranslation();
  return (
    <BlockStack gap="500">
      <Text as="h3" variant="headingMd">
        {t("eventMappingsStep.title")}
      </Text>
      <Text as="p" tone="subdued">
        {t("eventMappingsStep.description")}
      </Text>
      {Array.from(selectedPlatforms).map((platform) => {
        const config = platformConfigs[platform];
        if (!config) return null;
        return (
          <EventMappingEditor
            key={platform}
            platform={platform as "google" | "meta" | "tiktok"}
            mappings={config.eventMappings}
            onMappingChange={(shopifyEvent, platformEvent) =>
              onEventMappingUpdate(platform, shopifyEvent, platformEvent)
            }
          />
        );
      })}
    </BlockStack>
  );
}
