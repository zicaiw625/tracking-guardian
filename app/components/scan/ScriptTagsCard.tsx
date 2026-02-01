import { Card, BlockStack, InlineStack, Text, Badge, Banner } from "@shopify/polaris";
import type { ScriptTag } from "../../types";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("scan.scriptTagsCard.title")}
          </Text>
          {deprecationStatus && (
            <Badge tone={deprecationStatus.isExpired ? "critical" : "warning"}>
              {deprecationStatus.badge.text}
            </Badge>
          )}
        </InlineStack>
        <BlockStack gap="200">
          <InlineStack align="space-between">
            <Text as="span">{t("scan.scriptTagsCard.installedCount")}</Text>
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
