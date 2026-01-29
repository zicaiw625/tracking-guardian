import { Badge, Box, BlockStack, Text } from "@shopify/polaris";

export function ScoreCard({
  title,
  score,
  description,
  tone,
}: {
  title: string;
  score: number;
  description: string;
  tone: "success" | "warning" | "critical";
}) {
  return (
    <Box
      background={
        tone === "success"
          ? "bg-fill-success-secondary"
          : tone === "warning"
            ? "bg-fill-warning-secondary"
            : "bg-fill-critical-secondary"
      }
      padding="400"
      borderRadius="200"
    >
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">
          {title}
        </Text>
        <Text as="p" variant="heading2xl" fontWeight="bold">
          {score}%
        </Text>
        <Text as="p" variant="bodySm">
          {description}
        </Text>
      </BlockStack>
    </Box>
  );
}

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <Badge tone="success">通过</Badge>;
    case "failed":
      return <Badge tone="critical">失败</Badge>;
    case "missing_params":
      return <Badge tone="warning">参数缺失</Badge>;
    case "not_tested":
      return <Badge>未测试</Badge>;
    case "completed":
      return <Badge tone="success">已完成</Badge>;
    case "running":
      return <Badge tone="info">运行中</Badge>;
    case "pending":
      return <Badge>待运行</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

export function PlatformBadge({ platform }: { platform: string }) {
  const names: Record<string, string> = {
    google: "GA4",
    meta: "Meta",
    tiktok: "TikTok",
  };
  return <Badge>{names[platform] || platform}</Badge>;
}
