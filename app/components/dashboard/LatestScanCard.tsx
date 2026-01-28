import { memo } from "react";
import { Card, BlockStack, InlineStack, Text, Box, Badge, Button } from "@shopify/polaris";
import { EnhancedEmptyState } from "~/components/ui";

type SerializedLatestScan = {
  status: string;
  riskScore: number;
  createdAt: string | Date;
  identifiedPlatforms: string[];
} | null;

export const LatestScanCard = memo(function LatestScanCard({ latestScan }: { latestScan: SerializedLatestScan }) {
  if (!latestScan) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            最新扫描
          </Text>
          <EnhancedEmptyState
            icon="🔍"
            title="尚未进行扫描"
            description="完成上方第 1 步开始扫描。预计耗时约 10 秒，不会修改任何设置。"
            primaryAction={{
              content: "开始扫描",
              url: "/app/audit/start",
            }}
          />
        </BlockStack>
      </Card>
    );
  }
  const riskLevel =
    latestScan.riskScore >= 70
      ? { level: "高风险", tone: "critical" as const }
      : latestScan.riskScore >= 40
        ? { level: "中风险", tone: "warning" as const }
        : { level: "低风险", tone: "success" as const };
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            最新扫描
          </Text>
          <Badge tone={riskLevel.tone} size="large">
            {riskLevel.level}
          </Badge>
        </InlineStack>
        <Box
          background={
            latestScan.riskScore >= 70
              ? "bg-fill-critical"
              : latestScan.riskScore >= 40
                ? "bg-fill-warning"
                : "bg-fill-success"
          }
          padding="500"
          borderRadius="200"
        >
          <BlockStack gap="200" align="center">
            <Text as="p" variant="heading2xl" fontWeight="bold">
              {latestScan.riskScore}
            </Text>
            <Text as="p" variant="bodySm">
              / 100
            </Text>
          </BlockStack>
        </Box>
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" tone="subdued">
            扫描时间: {new Date(latestScan.createdAt).toLocaleDateString("zh-CN")}
          </Text>
          {latestScan.identifiedPlatforms.length > 0 ? (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                识别到的平台:
              </Text>
              <InlineStack gap="100" wrap>
                {latestScan.identifiedPlatforms.map((platform) => (
                  <Badge key={platform}>{platform}</Badge>
                ))}
              </InlineStack>
            </BlockStack>
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">
              未识别到追踪平台
            </Text>
          )}
        </BlockStack>
        <Button url="/app/audit/report" fullWidth>
          查看完整报告
        </Button>
      </BlockStack>
    </Card>
  );
});
