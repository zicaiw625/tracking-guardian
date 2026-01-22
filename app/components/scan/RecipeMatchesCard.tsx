import { useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Box,
  Banner,
} from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import { useToastContext } from "~/components/ui";
import type { ScanRecipeMatch } from "~/services/recipes/scan-integration.server";

export interface RecipeMatchesCardProps {
  matches: ScanRecipeMatch[];
  shopId: string;
}

export function RecipeMatchesCard({ matches, shopId: _shopId }: RecipeMatchesCardProps) {
  const fetcher = useFetcher();
  const { showSuccess, showError } = useToastContext();
  const [applyingRecipeId, setApplyingRecipeId] = useState<string | null>(null);

  if (matches.length === 0) {
    return null;
  }

  const handleApplyRecipe = (match: ScanRecipeMatch) => {
    if (!match.canApply) {
      showError("该迁移方案当前不可用");
      return;
    }
    setApplyingRecipeId(match.recipeId);
    const formData = new FormData();
    formData.append("_action", "apply_recipe");
    formData.append("recipeId", match.recipeId);
    if (match.sourceIdentifier) {
      formData.append("sourceIdentifier", match.sourceIdentifier);
    }
    fetcher.submit(formData, { method: "post" });
  };

  const fetcherData = fetcher.data as { success?: boolean; error?: string } | undefined;
  if (fetcherData?.success && applyingRecipeId) {
    showSuccess("迁移方案已创建，请前往迁移页面配置");
    setApplyingRecipeId(null);
  } else if (fetcherData?.error && applyingRecipeId) {
    showError(fetcherData.error);
    setApplyingRecipeId(null);
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
          检测到您的店铺中有可自动迁移的追踪脚本。点击"应用方案"可快速创建迁移配置草稿。
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
                  <Button
                    variant="primary"
                    onClick={() => handleApplyRecipe(match)}
                    loading={
                      applyingRecipeId === match.recipeId &&
                      fetcher.state === "submitting"
                    }
                    disabled={!match.canApply}
                  >
                    应用方案
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
