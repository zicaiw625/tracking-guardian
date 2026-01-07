

import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
  ProgressBar,
  DataTable,
  Banner,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon } from "~/components/icons";

interface BatchApplyProgressProps {
  total: number;
  completed: number;
  success: number;
  failed: number;
  skipped: number;
  results: Array<{
    shopId: string;
    shopDomain: string;
    status: "success" | "failed" | "skipped";
    message: string;
    platformsApplied?: string[];
  }>;
  isRunning: boolean;
}

export function BatchApplyProgress({
  total,
  completed,
  success,
  failed,
  skipped,
  results,
  isRunning,
}: BatchApplyProgressProps) {
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            批量应用进度
          </Text>
          {isRunning ? (
            <Badge tone="info">进行中</Badge>
          ) : (
            <Badge tone={failed === 0 ? "success" : "warning"}>
              {failed === 0 ? "全部完成" : "部分失败"}
            </Badge>
          )}
        </InlineStack>

        <Divider />

        <BlockStack gap="200">
          <ProgressBar progress={progress} tone="primary" />
          <InlineStack align="space-between">
            <Text as="span" variant="bodySm" tone="subdued">
              已完成 {completed} / {total}
            </Text>
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {Math.round(progress)}%
            </Text>
          </InlineStack>
        </BlockStack>

        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <InlineStack gap="400" align="space-between">
            <BlockStack gap="100" align="center">
              <CheckCircleIcon />
              <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                {success}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                成功
              </Text>
            </BlockStack>
            <BlockStack gap="100" align="center">
              <AlertCircleIcon />
              <Text as="p" variant="headingLg" fontWeight="bold">
                {skipped}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                跳过
              </Text>
            </BlockStack>
            <BlockStack gap="100" align="center">
              <AlertCircleIcon />
              <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                {failed}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                失败
              </Text>
            </BlockStack>
          </InlineStack>
        </Box>

        {results.length > 0 && (
          <>
            <Divider />
            <DataTable
              columnContentTypes={["text", "text", "text"]}
              headings={["店铺", "状态", "详情"]}
              rows={results.map((r) => [
                r.shopDomain || r.shopId,
                <Badge
                  key={r.shopId}
                  tone={
                    r.status === "success"
                      ? "success"
                      : r.status === "skipped"
                        ? "warning"
                        : "critical"
                  }
                >
                  {r.status === "success"
                    ? "成功"
                    : r.status === "skipped"
                      ? "跳过"
                      : "失败"}
                </Badge>,
                <BlockStack key={`detail-${r.shopId}`} gap="100">
                  <Text as="span" variant="bodySm">
                    {r.message}
                  </Text>
                  {r.platformsApplied && r.platformsApplied.length > 0 && (
                    <InlineStack gap="100">
                      {r.platformsApplied.map((p) => (
                        <Badge key={p}>{p}</Badge>
                      ))}
                    </InlineStack>
                  )}
                </BlockStack>,
              ])}
            />
          </>
        )}

        {!isRunning && completed === total && (
          <Banner tone={failed === 0 ? "success" : "warning"}>
            <Text as="p" variant="bodySm">
              {failed === 0
                ? `✅ 批量应用完成！成功应用到 ${success} 个店铺。`
                : `⚠️ 批量应用完成，但有 ${failed} 个店铺应用失败。请查看上方详情。`}
            </Text>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

