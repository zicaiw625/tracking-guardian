import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Banner,
} from "@shopify/polaris";
import type { ScanRecipeMatch } from "~/services/recipes/scan-integration.server";

export interface RecipeMatchesCardProps {
  matches: ScanRecipeMatch[];
  shopId: string;
}

export function RecipeMatchesCard({ matches, shopId: _shopId }: RecipeMatchesCardProps) {
  if (matches.length === 0) {
    return null;
  }

  const getConfidenceBadgeTone = (confidence: number) => {
    if (confidence >= 0.8) return "success";
    if (confidence >= 0.5) return "info";
    return "warning";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return "高匹配度";
    if (confidence >= 0.5) return "中匹配度";
    return "低匹配度";
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            推荐迁移方案
          </Text>
          <Badge tone="info">{`${matches.length} 个方案`}</Badge>
        </InlineStack>
        <Banner tone="info">
          检测到您的店铺中有可迁移的追踪脚本。以下是推荐的迁移模板，您可以在迁移页面手动配置。
        </Banner>
        <BlockStack gap="300">
          {matches.map((match) => (
            <Box
              key={match.recipeId}
              background="bg-surface-secondary"
              padding="400"
              borderRadius="200"
            >
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {match.recipeName}
                      </Text>
                      <Badge tone={getConfidenceBadgeTone(match.confidence)}>
                        {`${getConfidenceLabel(match.confidence)} (${(match.confidence * 100).toFixed(0)}%)`}
                      </Badge>
                      <Badge>
                        {match.sourceType === "script_tag"
                          ? "ScriptTag"
                          : "Additional Script"}
                      </Badge>
                    </InlineStack>
                    {match.sourceContent && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {match.sourceContent.substring(0, 150)}
                        {match.sourceContent.length > 150 ? "..." : ""}
                      </Text>
                    )}
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
