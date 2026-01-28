import { BlockStack, Text } from "@shopify/polaris";
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
  return (
    <BlockStack gap="500">
      <Text as="h3" variant="headingMd">
        配置事件映射
      </Text>
      <Text as="p" tone="subdued">
        将 Shopify 事件映射到各平台的事件名称。我们已为您配置了推荐映射。
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
