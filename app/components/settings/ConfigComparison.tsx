

import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
  DataTable,
} from "@shopify/polaris";
import type { PixelConfigSnapshot } from "../../services/pixel-rollback.server";

interface ConfigComparisonProps {
  current: PixelConfigSnapshot & { version: number; updatedAt: Date };
  previous: PixelConfigSnapshot | null;
  differences: Array<{
    field: string;
    current: unknown;
    previous: unknown;
    changed: boolean;
  }>;
  platform: string;
}

const FIELD_LABELS: Record<string, string> = {
  platformId: "平台 ID",
  clientSideEnabled: "客户端追踪",
  serverSideEnabled: "服务端追踪",
  eventMappings: "事件映射",
  clientConfig: "客户端配置",
  environment: "环境",
  credentialsEncrypted: "凭证",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

export function ConfigComparison({
  current,
  previous,
  differences,
  platform,
}: ConfigComparisonProps) {
  if (!previous) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            配置对比
          </Text>
          <Text as="p" tone="subdued">
            暂无历史版本可对比
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const changedFields = differences.filter((d) => d.changed);
  const unchangedFields = differences.filter((d) => !d.changed);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            配置对比
          </Text>
          <Badge tone={changedFields.length > 0 ? undefined : "success"}>
            {`${changedFields.length} 项变更`}
          </Badge>
        </InlineStack>

        <Divider />

        {changedFields.length > 0 && (
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              变更项
            </Text>
            <DataTable
              columnContentTypes={["text", "text", "text"]}
              headings={["字段", "当前值", "上一个值"]}
              rows={changedFields.map((diff) => [
                FIELD_LABELS[diff.field] || diff.field,
                <Box key="current" padding="200">
                  <Text
                    as="span"
                    variant="bodySm"
                    tone={diff.changed ? "critical" : undefined}
                  >
                    {formatValue(diff.current)}
                  </Text>
                </Box>,
                <Box key="previous" padding="200">
                  <Text
                    as="span"
                    variant="bodySm"
                    tone={diff.changed ? "subdued" : undefined}
                  >
                    {formatValue(diff.previous)}
                  </Text>
                </Box>,
              ])}
            />
          </BlockStack>
        )}

        {unchangedFields.length > 0 && (
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              未变更项
            </Text>
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <BlockStack gap="200">
                {unchangedFields.map((diff) => (
                  <InlineStack key={diff.field} align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      {FIELD_LABELS[diff.field] || diff.field}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {formatValue(diff.current)}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </Box>
          </BlockStack>
        )}

        <Divider />

        <BlockStack gap="200">
          <InlineStack align="space-between">
            <Text as="span" variant="bodySm" tone="subdued">
              当前版本
            </Text>
            <Badge>{`v${current.version}`}</Badge>
          </InlineStack>
          <InlineStack align="space-between">
            <Text as="span" variant="bodySm" tone="subdued">
              更新时间
            </Text>
            <Text as="span" variant="bodySm">
              {new Date(current.updatedAt).toLocaleString("zh-CN")}
            </Text>
          </InlineStack>
          <InlineStack align="space-between">
            <Text as="span" variant="bodySm" tone="subdued">
              环境
            </Text>
            <Badge tone={current.environment === "live" ? "success" : "warning"}>
              {current.environment === "live" ? "生产" : "测试"}
            </Badge>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

