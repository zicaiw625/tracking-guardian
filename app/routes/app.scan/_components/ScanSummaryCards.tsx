import { Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Box, Divider, Icon, Banner } from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { getPlatformName } from "~/components/scan/utils";
import { safeFormatDate, validateRiskItemsArray } from "~/utils/scan-data-validation";
import { calculateEstimatedTime, getRiskLevelBackground, getRiskLevelBadgeTone } from "~/utils/scan-format";
import { isPlanAtLeast } from "~/utils/plans";

interface ScanSummaryCardsProps {
  latestScan: {
    riskScore: number;
    createdAt: unknown;
    riskItems?: unknown;
  };
  identifiedPlatforms: string[];
  scriptTags: Array<{ id: number }>;
  deprecationStatus?: {
    scriptTag?: {
      isExpired: boolean;
      badge: { text: string };
      description: string;
    };
  } | null;
  planIdSafe: string;
}

export function ScanSummaryCards({
  latestScan,
  identifiedPlatforms,
  scriptTags,
  deprecationStatus,
  planIdSafe,
}: ScanSummaryCardsProps) {
  const riskItems = validateRiskItemsArray(latestScan.riskItems);
  const estimatedTime = calculateEstimatedTime(riskItems);
  const riskBackground = getRiskLevelBackground(latestScan.riskScore);
  const riskBadgeTone = getRiskLevelBadgeTone(latestScan.riskScore);
  const riskLevelText = latestScan.riskScore > 60 ? "High" : latestScan.riskScore > 30 ? "Med" : "Low";

  return (
    <Layout>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              风险评分
            </Text>
            <Box background={riskBackground} padding="600" borderRadius="200">
              <BlockStack gap="200" align="center">
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {latestScan.riskScore}
                </Text>
                <Text as="p" variant="bodySm">
                  / 100
                </Text>
              </BlockStack>
            </Box>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                风险等级
              </Text>
              <Badge tone={riskBadgeTone}>
                {riskLevelText}
              </Badge>
            </InlineStack>
            {estimatedTime.totalMinutes > 0 && (
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  预计修复时间
                </Text>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {estimatedTime.hours > 0 ? `${estimatedTime.hours} 小时 ` : ""}{estimatedTime.minutes > 0 ? `${estimatedTime.minutes} 分钟` : ""}
                </Text>
              </InlineStack>
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              扫描时间:{" "}
              {safeFormatDate(latestScan.createdAt)}
            </Text>
            <Divider />
            <BlockStack gap="200">
              <Button
                url={isPlanAtLeast(planIdSafe, "starter") ? "/app/migrate" : "/app/billing"}
                variant={isPlanAtLeast(planIdSafe, "starter") ? "primary" : "secondary"}
                fullWidth
              >
                {isPlanAtLeast(planIdSafe, "starter")
                  ? "启用Purchase-only修复（10分钟）"
                  : "升级到 Migration 启用修复"}
              </Button>
              {!isPlanAtLeast(planIdSafe, "growth") && (
                <Button
                  url="/app/billing"
                  variant="secondary"
                  fullWidth
                >
                  启用Full-funnel修复（30分钟，Growth）
                </Button>
              )}
            </BlockStack>
          </BlockStack>
        </Card>
      </Layout.Section>
      <Layout.Section variant="oneThird">
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
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                ScriptTags
              </Text>
              {deprecationStatus?.scriptTag && (
                <Badge tone={deprecationStatus.scriptTag.isExpired ? "critical" : "warning"}>
                  {deprecationStatus.scriptTag.badge.text}
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
              {scriptTags.length > 0 && deprecationStatus?.scriptTag && (
                <Banner tone={deprecationStatus.scriptTag.isExpired ? "critical" : "warning"}>
                  <Text as="p">{deprecationStatus.scriptTag.description}</Text>
                </Banner>
              )}
            </BlockStack>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}
