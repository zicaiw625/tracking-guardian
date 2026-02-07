import { Card, BlockStack, InlineStack, Text, Icon } from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { getPlatformName } from "./utils";
import { useTranslation } from "react-i18next";

interface PlatformsCardProps {
  identifiedPlatforms: string[];
}

export function PlatformsCard({ identifiedPlatforms }: PlatformsCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("scan.summaryCards.platforms.title")}
        </Text>
        {identifiedPlatforms.length > 0 ? (
          <BlockStack gap="200">
            {identifiedPlatforms.map((platform) => (
              <InlineStack key={platform} gap="200" align="start">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span">{getPlatformName(platform, t)}</Text>
              </InlineStack>
            ))}
          </BlockStack>
        ) : (
          <Text as="p" tone="subdued">
            {t("scan.summaryCards.platforms.empty")}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
