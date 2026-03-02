import { Banner, BlockStack, List, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

interface TrackingLimitationsCardProps {
  tone?: "info" | "warning";
}

export function TrackingLimitationsCard({ tone = "info" }: TrackingLimitationsCardProps) {
  const { t } = useTranslation();

  return (
    <Banner tone={tone} title={t("trackingLimits.title")}>
      <BlockStack gap="200">
        <Text as="p" variant="bodySm">
          {t("trackingLimits.desc")}
        </Text>
        <List type="bullet">
          <List.Item>
            <Text as="span" variant="bodySm">
              {t("trackingLimits.items.0")}
            </Text>
          </List.Item>
          <List.Item>
            <Text as="span" variant="bodySm">
              {t("trackingLimits.items.1")}
            </Text>
          </List.Item>
          <List.Item>
            <Text as="span" variant="bodySm">
              {t("trackingLimits.items.2")}
            </Text>
          </List.Item>
        </List>
        <Text as="p" variant="bodySm" tone="subdued">
          {t("trackingLimits.note")}
        </Text>
      </BlockStack>
    </Banner>
  );
}
