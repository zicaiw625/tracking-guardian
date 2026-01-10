import { Card, BlockStack, Text, Box, Badge, InlineStack, Button, Banner } from "@shopify/polaris";
import { useMemo, type ReactNode } from "react";
import { ArrowRightIcon } from "~/components/icons";
import type { DependencyGraph } from "~/services/dependency-analysis.server";

interface DependencyGraphPreviewProps {
  dependencyGraph: DependencyGraph | null;
}

interface GraphSummary {
  totalNodes: number;
  totalEdges: number;
  nodesByRisk: Record<string, number>;
  nodesByCategory: Record<string, number>;
  avgDependencies: string;
  criticalPath: number;
}

export function DependencyGraphPreview({ dependencyGraph }: DependencyGraphPreviewProps) {
  const summary = useMemo<GraphSummary | null>(() => {
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
  const categoryLabels = {
    pixel: "像素追踪",
    affiliate: "联盟营销",
    survey: "问卷调研",
    support: "客服支持",
    analytics: "分析工具",
    other: "其他",
  } as const;
  const categorySectionData = useMemo<[string, number][] | null>(() => {
    if (!summary || !summary.nodesByCategory || typeof summary.nodesByCategory !== "object" || Object.keys(summary.nodesByCategory).length === 0) {
      return null;
    }
    return Object.entries(summary.nodesByCategory) as [string, number][];
  }, [summary]);
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
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            依赖关系概览
          </Text>
          <Badge tone="info">{`${String(summary?.totalNodes || 0)} 个资产`}</Badge>
        </InlineStack>
        {summary && (
          <BlockStack gap="400">
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
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                风险分布
              </Text>
              <InlineStack gap="200" wrap>
                {summary.nodesByRisk.high > 0 && (
                  <Badge tone="critical">
                    {`高风险: ${String(summary.nodesByRisk.high)}`}
                  </Badge>
                )}
                {summary.nodesByRisk.medium > 0 && (
                  <Badge tone="warning">
                    {`中风险: ${String(summary.nodesByRisk.medium)}`}
                  </Badge>
                )}
                {summary.nodesByRisk.low > 0 && (
                  <Badge tone="success">
                    {`低风险: ${String(summary.nodesByRisk.low)}`}
                  </Badge>
                )}
              </InlineStack>
            </BlockStack>
            {(categorySectionData !== null && categorySectionData.length > 0 ? (
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  类别分布
                </Text>
                <InlineStack gap="200" wrap>
                  {categorySectionData
                    .sort(([_, a], [__, b]) => {
                      const countA = typeof a === "number" ? a : 0;
                      const countB = typeof b === "number" ? b : 0;
                      return countB - countA;
                    })
                    .slice(0, 5)
                    .map(([category, count]) => {
                      const label = (categoryLabels[category as keyof typeof categoryLabels] as string) || category;
                      const countValue = typeof count === "number" ? count : 0;
                      return (
                        <Badge key={category}>
                          {`${String(label)}: ${String(countValue)}`}
                        </Badge>
                      );
                    })}
                </InlineStack>
              </BlockStack>
            ) : null) as ReactNode}
            {dependencyGraph.edges.length > 0 ? (
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">
                    依赖关系
                  </Text>
                  <Badge tone="info">
                    {`${String(dependencyGraph.edges.filter((e) => e.type === "depends_on" || e.type === "blocks" || e.type === "recommended_after").length)} 条`}
                  </Badge>
                </InlineStack>
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="200">
                    {dependencyGraph.edges
                      .filter((e) => e.type === "depends_on" || e.type === "blocks" || e.type === "recommended_after")
                      .slice(0, 5)
                      .map((edge, index) => {
                        const fromNode = dependencyGraph.nodes.find((n) => n.assetId === edge.from);
                        const toNode = dependencyGraph.nodes.find((n) => n.assetId === edge.to);
                        if (!fromNode || !toNode) return null;
                        const fromRiskBadge = fromNode.riskLevel === "high" ? "critical" :
                                            fromNode.riskLevel === "medium" ? "warning" : "info";
                        const toRiskBadge = toNode.riskLevel === "high" ? "critical" :
                                           toNode.riskLevel === "medium" ? "warning" : "info";
                        return (
                          <Box key={index} padding="200">
                            <InlineStack gap="200" blockAlign="center" wrap>
                              <Badge tone={toRiskBadge}>
                                {String(toNode.platform || toNode.category || toNode.displayName || toNode.id)}
                              </Badge>
                              <Text as="span" variant="bodySm" tone="subdued">依赖于</Text>
                              <Badge tone={fromRiskBadge}>
                                {String(fromNode.platform || fromNode.category || fromNode.displayName || fromNode.id)}
                              </Badge>
                            </InlineStack>
                          </Box>
                        );
                      })}
                    {dependencyGraph.edges.filter((e) => e.type === "depends_on" || e.type === "blocks" || e.type === "recommended_after").length > 5 ? (
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        还有 {String(dependencyGraph.edges.filter((e) => e.type === "depends_on" || e.type === "blocks" || e.type === "recommended_after").length - 5)} 条依赖关系...
                      </Text>
                    ) : null}
                  </BlockStack>
                </Box>
              </BlockStack>
            ) : null}
            {("cycles" in dependencyGraph && dependencyGraph.cycles && Array.isArray(dependencyGraph.cycles) && dependencyGraph.cycles.length > 0) ? (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    检测到 {String(dependencyGraph.cycles.length)} 个循环依赖
                  </Text>
                  <Text as="p" variant="bodySm">
                    循环依赖可能导致迁移顺序问题，建议手动调整迁移顺序
                  </Text>
                </BlockStack>
              </Banner>
            ) : null}
            <Button url="/app/scan" fullWidth icon={ArrowRightIcon}>
              查看完整依赖图
            </Button>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
