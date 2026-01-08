import { useMemo } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  List,
  Banner,
} from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon } from "~/components/icons";
import type { DependencyGraph } from "~/services/dependency-analysis.server";

function formatTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
}

interface MigrationDependencyGraphProps {
  dependencyGraph: DependencyGraph | null;
  onAssetClick?: (assetId: string) => void;
}

export function MigrationDependencyGraph({
  dependencyGraph,
  onAssetClick,
}: MigrationDependencyGraphProps) {
  const { sortedNodes, cycles, criticalPath } = useMemo(() => {
    if (!dependencyGraph) {
      return { sortedNodes: [], cycles: [], criticalPath: [] };
    }

    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    const nodeMap = new Map<string, typeof dependencyGraph.nodes[0]>();

    dependencyGraph.nodes.forEach((node) => {
      inDegree.set(node.id, 0);
      dependents.set(node.id, []);
      nodeMap.set(node.id, node);
    });

    dependencyGraph.edges.forEach((edge) => {

      if (edge.type === "depends_on") {
        const current = inDegree.get(edge.to) || 0;
        inDegree.set(edge.to, current + 1);

        const deps = dependents.get(edge.from) || [];
        deps.push(edge.to);
        dependents.set(edge.from, deps);
      }
    });

    const sorted: typeof dependencyGraph.nodes = [];
    const queue: string[] = [];

    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) {
        queue.push(nodeId);
      }
    });

    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (!nodeId) break;
      const node = nodeMap.get(nodeId);
      if (node) {
        sorted.push(node);
      }

      const dependentsList = dependents.get(nodeId) || [];
      dependentsList.forEach((dependentId) => {
        const current = inDegree.get(dependentId) || 0;
        inDegree.set(dependentId, Math.max(0, current - 1));

        if (inDegree.get(dependentId) === 0) {
          queue.push(dependentId);
        }
      });
    }

    const cycles: string[][] = [];
    const remaining = dependencyGraph.nodes.filter(
      (n) => !sorted.find((s) => s.id === n.id)
    );
    if (remaining.length > 0) {

      cycles.push(remaining.map((n) => n.id));
    }

    const criticalPath: string[] = [];
    const pathLengths = new Map<string, number>();

    const calculatePathLength = (nodeId: string): number => {
      if (pathLengths.has(nodeId)) {
        return pathLengths.get(nodeId)!;
      }

      const node = nodeMap.get(nodeId);
      if (!node) return 0;

      const incomingEdges = dependencyGraph.edges.filter(
        (e) => e.to === nodeId && e.type === "depends_on"
      );

      if (incomingEdges.length === 0) {
        pathLengths.set(nodeId, 1);
        return 1;
      }

      const maxLength =
        Math.max(
          ...incomingEdges.map((e) => calculatePathLength(e.from))
        ) + 1;
      pathLengths.set(nodeId, maxLength);
      return maxLength;
    };

    dependencyGraph.nodes.forEach((node) => {
      calculatePathLength(node.id);
    });

    const maxLength = Math.max(...Array.from(pathLengths.values()));
    const criticalNode = Array.from(pathLengths.entries()).find(
      ([, length]) => length === maxLength
    )?.[0];

    if (criticalNode) {

      let current = criticalNode;
      while (current) {
        criticalPath.unshift(current);
        const incomingEdge = dependencyGraph.edges.find(
          (e) => e.to === current && e.type === "depends_on"
        );
        if (incomingEdge) {
          current = incomingEdge.from;
        } else {
          break;
        }
      }
    }

    return { sortedNodes: sorted, cycles, criticalPath };
  }, [dependencyGraph]);

  if (!dependencyGraph || dependencyGraph.nodes.length === 0) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            依赖关系分析
          </Text>
          <Banner>
            <Text as="p" variant="bodySm">
              暂无待迁移的资产，或资产之间没有依赖关系。
            </Text>
          </Banner>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            依赖关系分析
          </Text>
          <Badge tone="info">
            {`${dependencyGraph.nodes.length} 个资产`}
          </Badge>
        </InlineStack>

        {cycles.length > 0 && (
          <Banner tone="critical">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                检测到循环依赖
              </Text>
              <Text as="p" variant="bodySm">
                以下资产之间存在循环依赖关系，需要手动调整迁移顺序：
              </Text>
              <List type="bullet">
                {cycles.map((cycle, index) => (
                  <List.Item key={index}>
                    <Text as="span" variant="bodySm">
                      {cycle.length} 个资产形成循环
                    </Text>
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </Banner>
        )}

        {criticalPath.length > 0 && (
          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
            borderWidth="025"
            borderColor="border"
          >
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h4" variant="headingSm">
                  关键路径（最长依赖链）
                </Text>
                <Badge>
                  {`${criticalPath.length} 步`}
                </Badge>
              </InlineStack>
              <List type="number">
                {criticalPath.map((nodeId, index) => {
                  const node = dependencyGraph.nodes.find((n) => n.id === nodeId);
                  if (!node) return null;

                  return (
                    <List.Item key={nodeId}>
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {node.displayName || node.assetId.substring(0, 8) + "..."}
                        </Text>
                        <Badge
                          tone={
                            node.riskLevel === "high"
                              ? "critical"
                              : node.riskLevel === "medium"
                                ? "warning"
                                : "info"
                          }
                        >
                          {node.riskLevel}
                        </Badge>
                        {node.platform && (
                          <Badge tone="info">{node.platform}</Badge>
                        )}
                        {node.priority && (
                          <Badge tone="success">
                            {`优先级: ${node.priority}/10`}
                          </Badge>
                        )}
                        {node.estimatedTimeMinutes && (
                          <Badge tone="info">
                            {`预计: ${formatTime(node.estimatedTimeMinutes)}`}
                          </Badge>
                        )}
                      </InlineStack>
                    </List.Item>
                  );
                })}
              </List>
            </BlockStack>
          </Box>
        )}

        <Box
          background="bg-surface-secondary"
          padding="400"
          borderRadius="200"
          borderWidth="025"
          borderColor="border"
        >
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              推荐迁移顺序（基于依赖关系）
            </Text>
            <List type="number">
              {sortedNodes.map((node, index) => {
                const dependencies = dependencyGraph.edges
                  .filter((e) => e.to === node.id && e.type === "depends_on")
                  .map((e) => e.from);

                return (
                  <List.Item key={node.id}>
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {index + 1}. {node.assetId.substring(0, 8)}...
                        </Text>
                        <Badge
                          tone={
                            node.riskLevel === "high"
                              ? "critical"
                              : node.riskLevel === "medium"
                                ? "warning"
                                : "info"
                          }
                        >
                          {node.riskLevel}
                        </Badge>
                        {node.platform && (
                          <Badge tone="info">{node.platform}</Badge>
                        )}
                        {node.priority && (
                          <Badge tone="success">
                            {`优先级: ${node.priority}/10`}
                          </Badge>
                        )}
                        {node.estimatedTimeMinutes && (
                          <Badge tone="info">
                            {`预计: ${formatTime(node.estimatedTimeMinutes)}`}
                          </Badge>
                        )}
                      </InlineStack>
                      {dependencies.length > 0 && (
                        <Box paddingInlineStart="400">
                          <Text as="p" variant="bodySm" tone="subdued">
                            依赖: {dependencies.length} 个资产
                          </Text>
                        </Box>
                      )}
                    </BlockStack>
                  </List.Item>
                );
              })}
            </List>
          </BlockStack>
        </Box>

        <Box
          background="bg-surface-secondary"
          padding="400"
          borderRadius="200"
          borderWidth="025"
          borderColor="border"
        >
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              依赖关系详情
            </Text>
            {dependencyGraph.edges
              .filter((e) => e.type === "depends_on")
              .map((edge, index) => {
                const fromNode = dependencyGraph.nodes.find(
                  (n) => n.id === edge.from
                );
                const toNode = dependencyGraph.nodes.find(
                  (n) => n.id === edge.to
                );

                if (!fromNode || !toNode) return null;

                return (
                  <Box
                    key={index}
                    padding="300"
                    background="bg-surface"
                    borderRadius="100"
                  >
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodySm">
                        {fromNode.assetId.substring(0, 8)}...
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        →
                      </Text>
                      <Text as="span" variant="bodySm">
                        {toNode.assetId.substring(0, 8)}...
                      </Text>
                      {edge.reason && (
                        <Badge tone="info">{edge.reason}</Badge>
                      )}
                    </InlineStack>
                  </Box>
                );
              })}
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
