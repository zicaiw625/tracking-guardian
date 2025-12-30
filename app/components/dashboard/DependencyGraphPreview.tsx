
import { Card, BlockStack, Text, Box, Badge, InlineStack, Button } from "@shopify/polaris";
import { useMemo } from "react";
import { ArrowRightIcon } from "~/components/icons";
import type { DependencyGraph } from "~/services/dependency-analysis.server";

interface DependencyGraphPreviewProps {
  dependencyGraph: DependencyGraph | null;
}

export function DependencyGraphPreview({ dependencyGraph }: DependencyGraphPreviewProps) {
  const summary = useMemo(() => {
    if (!dependencyGraph || dependencyGraph.nodes.length === 0) {
      return null;
    }

    const nodesByRisk: Record<string, number> = { high: 0, medium: 0, low: 0 };
    const nodesByCategory: Record<string, number> = {};
    const dependencyCounts: number[] = [];

    dependencyGraph.nodes.forEach((node) => {
      const riskLevel = node.riskLevel.toLowerCase();
      if (riskLevel === "high" || riskLevel === "medium" || riskLevel === "low") {
        nodesByRisk[riskLevel] = (nodesByRisk[riskLevel] || 0) + 1;
      }

      const category = node.category || "other";
      nodesByCategory[category] = (nodesByCategory[category] || 0) + 1;

      const depCount = dependencyGraph.edges.filter(
        (e) => e.to === node.id && e.type === "depends_on"
      ).length;
      dependencyCounts.push(depCount);
    });

    const avgDependencies = dependencyCounts.length > 0
      ? (dependencyCounts.reduce((a, b) => a + b, 0) / dependencyCounts.length).toFixed(1)
      : "0";

    const criticalPath = dependencyGraph.edges.filter((e) => e.type === "depends_on").length;

    return {
      totalNodes: dependencyGraph.nodes.length,
      totalEdges: dependencyGraph.edges.length,
      nodesByRisk,
      nodesByCategory,
      avgDependencies,
      criticalPath,
    };
  }, [dependencyGraph]);

  if (!dependencyGraph || dependencyGraph.nodes.length === 0) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            依赖关系
          </Text>
          <Box padding="400">
            <Text as="p" tone="subdued" alignment="center">
              暂无依赖关系数据
            </Text>
          </Box>
        </BlockStack>
      </Card>
    );
  }

  const categoryLabels: Record<string, string> = {
    pixel: "像素追踪",
    affiliate: "联盟营销",
    survey: "问卷调研",
    support: "客服支持",
    analytics: "分析工具",
    other: "其他",
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            依赖关系概览
          </Text>
          <Badge tone="info">{summary?.totalNodes || 0} 个资产</Badge>
        </InlineStack>

        {summary && (
          <BlockStack gap="400">
            {/* 统计信息 */}
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    总依赖关系
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {summary.totalEdges} 条
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    平均依赖数
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {summary.avgDependencies} 个
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    关键路径
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {summary.criticalPath} 条
                  </Text>
                </InlineStack>
              </BlockStack>
            </Box>

            {/* 风险分布 */}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                风险分布
              </Text>
              <InlineStack gap="200" wrap>
                {summary.nodesByRisk.high > 0 && (
                  <Badge tone="critical">
                    高风险: {summary.nodesByRisk.high}
                  </Badge>
                )}
                {summary.nodesByRisk.medium > 0 && (
                  <Badge tone="warning">
                    中风险: {summary.nodesByRisk.medium}
                  </Badge>
                )}
                {summary.nodesByRisk.low > 0 && (
                  <Badge tone="success">
                    低风险: {summary.nodesByRisk.low}
                  </Badge>
                )}
              </InlineStack>
            </BlockStack>

            {/* 类别分布 */}
            {Object.keys(summary.nodesByCategory).length > 0 && (
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  类别分布
                </Text>
                <InlineStack gap="200" wrap>
                  {Object.entries(summary.nodesByCategory)
                    .sort(([_, a], [__, b]) => b - a)
                    .slice(0, 5)
                    .map(([category, count]) => (
                      <Badge key={category}>
                        {categoryLabels[category] || category}: {count}
                      </Badge>
                    ))}
                </InlineStack>
              </BlockStack>
            )}

            {/* 依赖关系示例 */}
            {dependencyGraph.edges.length > 0 && (
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  依赖示例
                </Text>
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="200">
                    {dependencyGraph.edges
                      .filter((e) => e.type === "depends_on")
                      .slice(0, 3)
                      .map((edge, index) => {
                        const fromNode = dependencyGraph.nodes.find((n) => n.id === edge.from);
                        const toNode = dependencyGraph.nodes.find((n) => n.id === edge.to);
                        if (!fromNode || !toNode) return null;

                        return (
                          <Text key={index} as="p" variant="bodySm">
                            <strong>{toNode.platform || toNode.category}</strong> 依赖于{" "}
                            <strong>{fromNode.platform || fromNode.category}</strong>
                            {edge.reason && (
                              <Text as="span" tone="subdued"> ({edge.reason})</Text>
                            )}
                          </Text>
                        );
                      })}
                    {dependencyGraph.edges.filter((e) => e.type === "depends_on").length > 3 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        还有 {dependencyGraph.edges.filter((e) => e.type === "depends_on").length - 3} 条依赖关系...
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              </BlockStack>
            )}

            <Button url="/app/scan" fullWidth icon={ArrowRightIcon}>
              查看完整依赖图
            </Button>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

