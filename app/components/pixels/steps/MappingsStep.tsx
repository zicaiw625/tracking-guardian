import { Card, BlockStack, Text, Banner, List, Divider } from "@shopify/polaris";
import { EventMappingEditor } from "~/components/migrate/EventMappingEditor";
import { useTranslation } from "react-i18next";
import type { SupportedPlatform, PlatformConfig } from "../constants";

interface MappingsStepProps {
  selectedPlatforms: Set<SupportedPlatform>;
  platformConfigs: Partial<Record<SupportedPlatform, PlatformConfig>>;
  onEventMappingUpdate: (
    platform: SupportedPlatform,
    shopifyEvent: string,
    platformEvent: string
  ) => void;
}

export function MappingsStep({
  selectedPlatforms,
  platformConfigs,
  onEventMappingUpdate,
}: MappingsStepProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          {t("pixelMigration.steps.mappings")}
        </Text>
        <Text as="p" tone="subdued">
          {t("pixelMigration.eventMapping.description", { platform: "" }).replace("to  events", "to platform events")}
        </Text>
        <Banner tone="warning">
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("pixelMigration.sandbox.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("pixelMigration.sandbox.desc")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("pixelMigration.sandbox.limits.dom")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("pixelMigration.sandbox.limits.storage")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("pixelMigration.sandbox.limits.cookie")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("pixelMigration.sandbox.limits.api")}
                </Text>
              </List.Item>
            </List>
            <Divider />
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("pixelMigration.sandbox.v1Events.title")}
            </Text>
            <List type="bullet">
              {Object.entries(t("pixelMigration.sandbox.v1Events", { returnObjects: true }) as Record<string, string>)
                .filter(([key]) => key !== "title")
                .map(([key, value]) => (
                  <List.Item key={key}>
                    <Text as="span" variant="bodySm">
                      {value}
                    </Text>
                  </List.Item>
                ))}
            </List>
            <Divider />
            <Text as="p" variant="bodySm" fontWeight="semibold" tone="critical">
              {t("pixelMigration.sandbox.unsupported.title")}
            </Text>
            <List type="bullet">
              {Object.entries(t("pixelMigration.sandbox.unsupported", { returnObjects: true }) as Record<string, string>)
                .filter(([key]) => key !== "title")
                .map(([key, value]) => (
                  <List.Item key={key}>
                    <Text as="span" variant="bodySm">
                      {value}
                    </Text>
                  </List.Item>
                ))}
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("pixelMigration.sandbox.reason")}
            </Text>
          </BlockStack>
        </Banner>
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
    </Card>
  );
}
