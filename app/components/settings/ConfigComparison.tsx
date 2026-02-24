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
import { useTranslation } from "react-i18next";
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

export function ConfigComparison({
  current,
  previous,
  differences,
  platform: _platform,
}: ConfigComparisonProps) {
  const { t } = useTranslation();

  const FIELD_LABELS: Record<string, string> = {
    platformId: t("configComparison.fieldLabels.platformId"),
    clientSideEnabled: t("configComparison.fieldLabels.clientSideEnabled"),
    serverSideEnabled: t("configComparison.fieldLabels.serverSideEnabled"),
    eventMappings: t("configComparison.fieldLabels.eventMappings"),
    clientConfig: t("configComparison.fieldLabels.clientConfig"),
    environment: t("configComparison.fieldLabels.environment"),
    credentialsEncrypted: t("configComparison.fieldLabels.credentialsEncrypted"),
  };

  function formatValue(value: unknown): string {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? t("configComparison.boolean.yes") : t("configComparison.boolean.no");
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  if (!previous) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            {t("configComparison.title")}
          </Text>
          <Text as="p" tone="subdued">
            {t("configComparison.noHistory")}
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
            {t("configComparison.title")}
          </Text>
          <Badge tone={changedFields.length > 0 ? undefined : "success"}>
            {t("configComparison.changesCount", { count: changedFields.length })}
          </Badge>
        </InlineStack>
        <Divider />
        {changedFields.length > 0 && (
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              {t("configComparison.changedFields")}
            </Text>
            <DataTable
              columnContentTypes={["text", "text", "text"]}
              headings={[t("configComparison.headings.field"), t("configComparison.headings.currentValue"), t("configComparison.headings.previousValue")]}
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
              {t("configComparison.unchangedFields")}
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
              {t("configComparison.currentVersion")}
            </Text>
            <Badge>{`v${current.version}`}</Badge>
          </InlineStack>
          <InlineStack align="space-between">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("configComparison.updatedAt")}
            </Text>
            <Text as="span" variant="bodySm">
              {new Date(current.updatedAt).toLocaleString("zh-CN")}
            </Text>
          </InlineStack>
          <InlineStack align="space-between">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("configComparison.environment")}
            </Text>
            <Badge tone={current.environment === "live" ? "success" : "warning"}>
              {current.environment === "live" ? t("configComparison.env.live") : t("configComparison.env.test")}
            </Badge>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
