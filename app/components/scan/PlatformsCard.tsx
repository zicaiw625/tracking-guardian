import { Card, BlockStack, InlineStack, Text, Icon } from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { getPlatformName } from "./utils";

interface PlatformsCardProps {
  identifiedPlatforms: string[];
}

export function PlatformsCard({ identifiedPlatforms }: PlatformsCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          检测到的平台
        </Text>
        {identifiedPlatforms.length > 0 ? (
          <BlockStack gap="200">
            {identifiedPlatforms.map((platform) => (
              <InlineStack key={platform} gap="200" align="start">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span">{getPlatformName(platform)}</Text>
              </InlineStack>
            ))}
          </BlockStack>
        ) : (
          <Text as="p" tone="subdued">
            未检测到追踪平台
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
