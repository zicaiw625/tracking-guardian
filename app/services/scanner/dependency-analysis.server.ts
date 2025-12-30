import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { AuditAsset } from "@prisma/client";

export interface DependencyNode {
  assetId: string;
  assetName: string;
  category: string;
  platform?: string;
  riskLevel: string;
  migrationStatus: string;
  dependencies: string[];
  dependents: string[];
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: Array<{
    from: string;
    to: string;
    type: "dependency" | "suggested_order";
  }>;
  suggestedOrder: string[];
  cycles: string[][];
}

function detectDependencies(
  asset: AuditAsset,
  allAssets: AuditAsset[]
): string[] {
  const dependencies: string[] = [];

  // 首先从数据库的 dependencies 字段读取（这是主要来源）
  if (asset.dependencies && Array.isArray(asset.dependencies)) {
    dependencies.push(...(asset.dependencies as string[]));
  }

  // 兼容旧数据：从 details 字段读取
  const details = asset.details as Record<string, unknown> | null;
  if (details) {
    const explicitDeps = details.dependencies as string[] | undefined;
    if (explicitDeps && Array.isArray(explicitDeps)) {
      dependencies.push(...explicitDeps);
    }
  }

  // 基于业务逻辑的自动依赖检测
  switch (asset.category) {
    case "survey":
      // 问卷可能依赖订单追踪功能
      const orderTracking = allAssets.find(
        (a) => a.category === "support" && a.platform === "order_tracking"
      );
      if (orderTracking) {
        dependencies.push(orderTracking.id);
      }
      break;

    case "affiliate":
      // 联盟追踪通常依赖像素追踪
      const pixelAssets = allAssets.filter(
        (a) => a.category === "pixel" && a.platform === asset.platform
      );
      if (pixelAssets.length > 0) {
        dependencies.push(pixelAssets[0].id);
      }
      break;

    case "analytics":
      // 分析工具可能依赖像素追踪
      const analyticsPixels = allAssets.filter(
        (a) => a.category === "pixel"
      );
      if (analyticsPixels.length > 0) {
        dependencies.push(analyticsPixels[0].id);
      }
      break;
  }

  // 相同平台的依赖关系
  if (asset.platform) {
    const samePlatformAssets = allAssets.filter(
      (a) => a.platform === asset.platform && a.id !== asset.id
    );
    // 如果当前资产是像素，其他相同平台的资产可能依赖它
    if (samePlatformAssets.length > 0 && asset.category === "pixel") {
      // 不自动添加依赖，但可以建议
    }
  }

  return [...new Set(dependencies)];
}

function topologicalSort(nodes: DependencyNode[]): {
  order: string[];
  cycles: string[][];
} {
  const order: string[] = [];
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const nodeMap = new Map<string, DependencyNode>();
  
  nodes.forEach(node => {
    nodeMap.set(node.assetId, node);
  });

  function visit(nodeId: string, path: string[]): void {
    if (visiting.has(nodeId)) {
      // 检测到循环
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart >= 0) {
        const cycle = path.slice(cycleStart).concat(nodeId);
        cycles.push(cycle);
      }
      return;
    }

    if (visited.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (node) {
      node.dependencies.forEach(depId => {
        visit(depId, [...path, nodeId]);
      });
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    order.push(nodeId);
  }

  nodes.forEach(node => {
    if (!visited.has(node.assetId)) {
      visit(node.assetId, []);
    }
  });

  return { order, cycles };
}

export async function analyzeDependencies(
  shopId: string
): Promise<DependencyGraph> {
  const assets = await prisma.auditAsset.findMany({
    where: {
      shopId,
      migrationStatus: { not: "completed" },
    },
  });

  const nodes: DependencyNode[] = assets.map((asset) => {
    const dependencies = detectDependencies(asset, assets);

    return {
      assetId: asset.id,
      assetName: asset.displayName || asset.category,
      category: asset.category,
      platform: asset.platform || undefined,
      riskLevel: asset.riskLevel,
      migrationStatus: asset.migrationStatus,
      dependencies,
      dependents: [],
    };
  });

  // 构建反向依赖关系
  nodes.forEach((node) => {
    node.dependencies.forEach((depId) => {
      const depNode = nodes.find((n) => n.assetId === depId);
      if (depNode && !depNode.dependents.includes(node.assetId)) {
        depNode.dependents.push(node.assetId);
      }
    });
  });

  const edges: DependencyGraph["edges"] = [];
  nodes.forEach((node) => {
    node.dependencies.forEach((depId) => {
      edges.push({
        from: depId,
        to: node.assetId,
        type: "dependency",
      });
    });
  });

  const { order, cycles } = topologicalSort(nodes);

  // 添加建议顺序的边
  for (let i = 0; i < order.length - 1; i++) {
    edges.push({
      from: order[i],
      to: order[i + 1],
      type: "suggested_order",
    });
  }

  return {
    nodes,
    edges,
    suggestedOrder: order,
    cycles,
  };
}

export async function getAssetDependencies(
  assetId: string
): Promise<{
  dependencies: DependencyNode[];
  dependents: DependencyNode[];
}> {
  const asset = await prisma.auditAsset.findUnique({
    where: { id: assetId },
  });

  if (!asset) {
    return { dependencies: [], dependents: [] };
  }

  const graph = await analyzeDependencies(asset.shopId);
  const node = graph.nodes.find((n) => n.assetId === assetId);

  if (!node) {
    return { dependencies: [], dependents: [] };
  }

  const dependencies = node.dependencies
    .map((depId) => graph.nodes.find((n) => n.assetId === depId))
    .filter((n): n is DependencyNode => n !== undefined);

  const dependents = node.dependents
    .map((depId) => graph.nodes.find((n) => n.assetId === depId))
    .filter((n): n is DependencyNode => n !== undefined);

  return { dependencies, dependents };
}

export async function updateAssetDependencies(
  assetId: string,
  dependencies: string[]
): Promise<void> {
  try {
    await prisma.auditAsset.update({
      where: { id: assetId },
      data: {
        dependencies: dependencies,
      },
    });
    logger.info(`Updated dependencies for asset ${assetId}`, { dependencies });
  } catch (error) {
    logger.error(`Failed to update dependencies for asset ${assetId}`, error);
    throw error;
  }
}

export async function visualizeDependencyGraph(
  shopId: string
): Promise<{
  nodes: Array<{
    id: string;
    label: string;
    category: string;
    riskLevel: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;
  }>;
}> {
  const graph = await analyzeDependencies(shopId);

  return {
    nodes: graph.nodes.map((node) => ({
      id: node.assetId,
      label: node.assetName,
      category: node.category,
      riskLevel: node.riskLevel,
    })),
    edges: graph.edges,
  };
}

