import { Card, BlockStack, InlineStack, Text, Badge, Banner } from "@shopify/polaris";
import type { ScriptTag } from "../../types";

interface DeprecationInfo {
  badge: { text: string };
  isExpired: boolean;
  description: string;
}

interface ScriptTagsCardProps {
  scriptTags: ScriptTag[];
  deprecationStatus?: DeprecationInfo | null;
}

export function ScriptTagsCard({ scriptTags, deprecationStatus }: ScriptTagsCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            ScriptTags
          </Text>
          {deprecationStatus && (
            <Badge tone={deprecationStatus.isExpired ? "critical" : "warning"}>
              {deprecationStatus.badge.text}
            </Badge>
          )}
        </InlineStack>
        <BlockStack gap="200">
          <InlineStack align="space-between">
            <Text as="span">已安装数量</Text>
            <Text as="span" fontWeight="semibold">
              {scriptTags.length}
            </Text>
          </InlineStack>
          {scriptTags.length > 0 && deprecationStatus && (
            <Banner tone={deprecationStatus.isExpired ? "critical" : "warning"}>
              <p>{deprecationStatus.description}</p>
            </Banner>
          )}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
