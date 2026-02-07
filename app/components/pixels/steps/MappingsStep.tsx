import { Card, BlockStack, Text, Banner, List, Divider } from "@shopify/polaris";
import { EventMappingEditor } from "~/components/migrate/EventMappingEditor";
import type { SupportedPlatform, PlatformConfig } from "../constants";
import { useTranslation } from "react-i18next";

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
          {t("newPixelWizard.mappingsStep.title")}
        </Text>
        <Text as="p" tone="subdued">
          {t("newPixelWizard.mappingsStep.description")}
        </Text>
        <Banner tone="warning">
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("newPixelWizard.mappingsStep.sandboxWarning.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("newPixelWizard.mappingsStep.sandboxWarning.description")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.sandboxWarning.limitations.dom")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.sandboxWarning.limitations.storage")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.sandboxWarning.limitations.cookie")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.sandboxWarning.limitations.api")}
                </Text>
              </List.Item>
            </List>
            <Divider />
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("newPixelWizard.mappingsStep.supportedEvents.title")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.supportedEvents.items.checkout_started")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.supportedEvents.items.checkout_completed")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.supportedEvents.items.checkout_contact_info_submitted")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.supportedEvents.items.checkout_shipping_info_submitted")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.supportedEvents.items.payment_info_submitted")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.supportedEvents.items.product_added_to_cart")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.supportedEvents.items.product_viewed")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.supportedEvents.items.page_viewed")}
                </Text>
              </List.Item>
            </List>
            <Divider />
            <Text as="p" variant="bodySm" fontWeight="semibold" tone="critical">
              {t("newPixelWizard.mappingsStep.unsupportedEvents.title")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.unsupportedEvents.items.refund")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.unsupportedEvents.items.order_cancelled")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.unsupportedEvents.items.order_edited")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.unsupportedEvents.items.subscription_updated")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("newPixelWizard.mappingsStep.unsupportedEvents.items.subscription_cancelled")}
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("newPixelWizard.mappingsStep.unsupportedEvents.reason")}
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
