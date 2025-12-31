
import { useState, useMemo } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  DataTable,
  Banner,
  Select,
  TextField,
  Modal,
  List,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  InfoIcon,
} from "~/components/icons";
import type {
  MultiPlatformReconciliationResult,
  PlatformComparison,
  ReconciliationIssue,
} from "../../services/verification/channel-reconciliation.server";

interface ChannelReconciliationPanelProps {
  data: MultiPlatformReconciliationResult;
  onRefresh?: () => void;
  onOrderClick?: (orderId: string) => void;
}

const PLATFORM_NAMES: Record<string, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
  pinterest: "Pinterest",
};

const SEVERITY_TONES: Record<string, "critical" | "warning" | "info" | "success"> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

export function ChannelReconciliationPanel({
  data,
  onRefresh,
  onOrderClick,
}: ChannelReconciliationPanelProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showOrderDetails, setShowOrderDetails] = useState(false);

  const filteredPlatforms = useMemo(() => {
    if (selectedPlatform === "all") {
      return data.platforms;
    }
    return data.platforms.filter((p) => p.platform === selectedPlatform);
  }, [data.platforms, selectedPlatform]);

  const handleOrderClick = (orderId: string) => {
    setSelectedOrderId(orderId);
    setShowOrderDetails(true);
    if (onOrderClick) {
      onOrderClick(orderId);
    }
  };

  const overallHealth = useMemo(() => {
    if (data.summary.overallMatchRate >= 95) return { tone: "success" as const, label: "优秀" };
    if (data.summary.overallMatchRate >= 90) return { tone: "warning" as const, label: "良好" };
    if (data.summary.overallMatchRate >= 80) return { tone: "info" as const, label: "一般" };
    return { tone: "critical" as const, label: "需改进" };
  }, [data.summary.overallMatchRate]);

  return (
    <BlockStack gap="500">
      {}
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              多平台渠道对账
            </Text>
            <InlineStack gap="200">
              <Badge tone={overallHealth.tone}>{overallHealth.label}</Badge>
              {onRefresh && (
                <Button size="slim" onClick={onRefresh}>
                  刷新
                </Button>
              )}
            </InlineStack>
          </InlineStack>

          <BlockStack gap="300">
            <InlineStack gap="400" wrap>
              <Box minWidth="200px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Shopify 订单数
                  </Text>
                  <Text as="span" variant="headingLg" fontWeight="bold">
                    {data.summary.totalShopifyOrders}
                  </Text>
                </BlockStack>
              </Box>
              <Box minWidth="200px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    平台事件总数
                  </Text>
                  <Text as="span" variant="headingLg" fontWeight="bold">
                    {data.summary.totalPlatformEvents}
                  </Text>
                </BlockStack>
              </Box>
              <Box minWidth="200px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    整体匹配率
                  </Text>
                  <Text as="span" variant="headingLg" fontWeight="bold">
                    {data.summary.overallMatchRate.toFixed(2)}%
                  </Text>
                </BlockStack>
              </Box>
              <Box minWidth="200px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    对比平台数
                  </Text>
                  <Text as="span" variant="headingLg" fontWeight="bold">
                    {data.summary.platformsCompared}
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>

            <Text as="p" variant="bodySm" tone="subdued">
              分析期间: {new Date(data.summary.periodStart).toLocaleString("zh-CN")} -{" "}
              {new Date(data.summary.periodEnd).toLocaleString("zh-CN")}
            </Text>
          </BlockStack>
        </BlockStack>
      </Card>

      {}
      {data.crossPlatformAnalysis.platformsWithDiscrepancies.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              跨平台分析
            </Text>
            <BlockStack gap="200">
              {data.crossPlatformAnalysis.platformsInAgreement.length > 0 && (
                <Banner tone="success">
                  <Text as="p" variant="bodySm">
                    <strong>一致性良好的平台：</strong>
                    {data.crossPlatformAnalysis.platformsInAgreement
                      .map((p) => PLATFORM_NAMES[p] || p)
                      .join(", ")}
                  </Text>
                </Banner>
              )}
              {data.crossPlatformAnalysis.platformsWithDiscrepancies.length > 0 && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    <strong>存在差异的平台：</strong>
                    {data.crossPlatformAnalysis.platformsWithDiscrepancies
                      .map((p) => PLATFORM_NAMES[p] || p)
                      .join(", ")}
                  </Text>
                </Banner>
              )}
              {data.crossPlatformAnalysis.commonMissingOrders.length > 0 && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    <strong>所有平台都缺失的订单：</strong>
                    {data.crossPlatformAnalysis.commonMissingOrders.length} 个
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </BlockStack>
        </Card>
      )}

      {}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm">
              平台对比详情
            </Text>
            <Box minWidth="200px">
              <Select
                label=""
                labelHidden
                options={[
                  { label: "所有平台", value: "all" },
                  ...data.platforms.map((p) => ({
                    label: PLATFORM_NAMES[p.platform] || p.platform,
                    value: p.platform,
                  })),
                ]}
                value={selectedPlatform}
                onChange={setSelectedPlatform}
              />
            </Box>
          </InlineStack>
        </BlockStack>
      </Card>

      {}
      <Card>
        <BlockStack gap="400">
          <DataTable
            columnContentTypes={[
              "text",
              "numeric",
              "numeric",
              "text",
              "text",
              "numeric",
              "text",
            ]}
            headings={[
              "平台",
              "Shopify 订单",
              "平台事件",
              "匹配率",
              "差异",
              "金额差异",
              "问题",
            ]}
            rows={filteredPlatforms.map((comparison) => {
              const platformName =
                PLATFORM_NAMES[comparison.platform] || comparison.platform;
              const matchRateTone =
                comparison.stats.matchRate >= 95
                  ? "success"
                  : comparison.stats.matchRate >= 90
                    ? "warning"
                    : "critical";
              const issueCount = comparison.issues.length;
              const criticalIssues = comparison.issues.filter(
                (i) => i.severity === "critical"
              ).length;

              return [
                <Text key="platform" fontWeight="semibold">
                  {platformName}
                </Text>,
                comparison.stats.shopifyOrders,
                comparison.stats.platformEvents,
                <Badge key="matchRate" tone={matchRateTone}>
                  {comparison.stats.matchRate.toFixed(2)}%
                </Badge>,
                <Text key="discrepancy">
                  {comparison.stats.discrepancy} (
                  {comparison.stats.discrepancyRate.toFixed(2)}%)
                </Text>,
                comparison.stats.valueDiscrepancy
                  ? `${comparison.stats.valueDiscrepancy?.toFixed(2)} (${comparison.stats.valueDiscrepancyRate?.toFixed(2)}%)`
                  : "-",
                <Badge
                  key="issues"
                  tone={
                    criticalIssues > 0
                      ? "critical"
                      : issueCount > 0
                        ? "warning"
                        : "success"
                  }
                >
                  {issueCount} 个问题
                </Badge>,
              ];
            })}
          />
        </BlockStack>
      </Card>

      {}
      {filteredPlatforms.map((comparison) => (
        <PlatformComparisonCard
          key={comparison.platform}
          comparison={comparison}
          onOrderClick={handleOrderClick}
        />
      ))}

      {}
      {showOrderDetails && selectedOrderId && (
        <Modal
          open={showOrderDetails}
          onClose={() => {
            setShowOrderDetails(false);
            setSelectedOrderId(null);
          }}
          title={`订单详情: ${selectedOrderId}`}
        >
          <Modal.Section>
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                订单详情功能需要调用 getOrderCrossPlatformComparison API
              </Text>
            </Banner>
          </Modal.Section>
        </Modal>
      )}
    </BlockStack>
  );
}

function PlatformComparisonCard({
  comparison,
  onOrderClick,
}: {
  comparison: PlatformComparison;
  onOrderClick: (orderId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const platformName = PLATFORM_NAMES[comparison.platform] || comparison.platform;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            <Text as="h3" variant="headingSm">
              {platformName}
            </Text>
            <Badge
              tone={
                comparison.stats.matchRate >= 95
                  ? "success"
                  : comparison.stats.matchRate >= 90
                    ? "warning"
                    : "critical"
              }
            >
              匹配率: {comparison.stats.matchRate.toFixed(2)}%
            </Badge>
            {comparison.issues.length > 0 && (
              <Badge
                tone={
                  comparison.issues.some((i) => i.severity === "critical")
                    ? "critical"
                    : "warning"
                }
              >
                {comparison.issues.length} 个问题
              </Badge>
            )}
          </InlineStack>
          <Button
            size="slim"
            variant="plain"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : "展开详情"}
          </Button>
        </InlineStack>

        {expanded && (
          <BlockStack gap="400">
            <Divider />

            {}
            <BlockStack gap="300">
              <Text as="h4" variant="headingSm">
                统计信息
              </Text>
              <Box
                padding="400"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Shopify 订单数
                    </Text>
                    <Text as="span" fontWeight="semibold">
                      {comparison.stats.shopifyOrders}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      平台事件数
                    </Text>
                    <Text as="span" fontWeight="semibold">
                      {comparison.stats.platformEvents}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      差异订单数
                    </Text>
                    <Text as="span" fontWeight="semibold">
                      {comparison.stats.discrepancy} (
                      {comparison.stats.discrepancyRate.toFixed(2)}%)
                    </Text>
                  </InlineStack>
                  {comparison.stats.valueDiscrepancy !== undefined && (
                    <>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Shopify 总金额
                        </Text>
                        <Text as="span" fontWeight="semibold">
                          {comparison.stats.shopifyTotalValue.toFixed(2)}
                        </Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          平台总金额
                        </Text>
                        <Text as="span" fontWeight="semibold">
                          {comparison.stats.platformTotalValue.toFixed(2)}
                        </Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          金额差异
                        </Text>
                        <Text as="span" fontWeight="semibold">
                          {comparison.stats.valueDiscrepancy.toFixed(2)} (
                          {comparison.stats.valueDiscrepancyRate?.toFixed(2)}%)
                        </Text>
                      </InlineStack>
                    </>
                  )}
                </BlockStack>
              </Box>
            </BlockStack>

            {}
            {comparison.issues.length > 0 && (
              <BlockStack gap="300">
                <Text as="h4" variant="headingSm">
                  发现的问题
                </Text>
                <BlockStack gap="200">
                  {comparison.issues.map((issue, index) => (
                    <Banner
                      key={index}
                      tone={SEVERITY_TONES[issue.severity] || "info"}
                      title={getIssueTypeLabel(issue.type)}
                    >
                      <Text as="p" variant="bodySm">
                        {issue.message}
                      </Text>
                    </Banner>
                  ))}
                </BlockStack>
              </BlockStack>
            )}

            {}
            {comparison.stats.missingOrders.length > 0 && (
              <BlockStack gap="300">
                <Text as="h4" variant="headingSm">
                  缺失订单 ({comparison.stats.missingOrders.length} 个)
                </Text>
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                  maxHeight="200px"
                  style={{ overflowY: "auto" }}
                >
                  <List type="bullet">
                    {comparison.stats.missingOrders.map((orderId) => (
                      <List.Item key={orderId}>
                        <Button
                          variant="plain"
                          size="micro"
                          onClick={() => onOrderClick(orderId)}
                        >
                          {orderId}
                        </Button>
                      </List.Item>
                    ))}
                  </List>
                </Box>
              </BlockStack>
            )}

            {}
            {comparison.stats.duplicateOrders.length > 0 && (
              <BlockStack gap="300">
                <Text as="h4" variant="headingSm">
                  重复订单 ({comparison.stats.duplicateOrders.length} 个)
                </Text>
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                  maxHeight="200px"
                  style={{ overflowY: "auto" }}
                >
                  <List type="bullet">
                    {comparison.stats.duplicateOrders.map((orderId) => (
                      <List.Item key={orderId}>
                        <Button
                          variant="plain"
                          size="micro"
                          onClick={() => onOrderClick(orderId)}
                        >
                          {orderId}
                        </Button>
                      </List.Item>
                    ))}
                  </List>
                </Box>
              </BlockStack>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

function getIssueTypeLabel(type: ReconciliationIssue["type"]): string {
  switch (type) {
    case "missing_order":
      return "缺失订单";
    case "value_mismatch":
      return "金额不匹配";
    case "duplicate_order":
      return "重复订单";
    case "timing_issue":
      return "时间延迟";
    default:
      return "未知问题";
  }
}

