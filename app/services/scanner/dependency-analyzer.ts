import type { AuditAsset } from "@prisma/client";
import prisma from "../../db.server";

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
  if (asset.dependencies && Array.isArray(asset.dependencies)) {
    dependencies.push(...(asset.dependencies as string[]));
  }
  const details = asset.details as Record<string, unknown> | null;
  if (details) {
    const explicitDeps = details.dependencies as string[] | undefined;
    if (explicitDeps && Array.isArray(explicitDeps)) {
      dependencies.push(...explicitDeps);
    }
  }
  switch (asset.category) {
    case "survey":
      const orderTracking = allAssets.find(
        (a) => a.category === "support" && a.platform === "order_tracking"
      );
      if (orderTracking) {
        dependencies.push(orderTracking.id);
      }
      break;
    case "affiliate":
      const pixelAssets = allAssets.filter(
        (a) => a.category === "pixel" && a.platform === asset.platform
      );
      if (pixelAssets.length > 0) {
        dependencies.push(pixelAssets[0].id);
      }
      break;
    case "analytics":
      const analyticsPixels = allAssets.filter(
        (a) => a.category === "pixel"
      );
      if (analyticsPixels.length > 0) {
        dependencies.push(analyticsPixels[0].id);
      }
      break;
  }
  if (asset.platform) {
    const samePlatformAssets = allAssets.filter(
      (a) => a.platform === asset.platform && a.id !== asset.id
    );
    if (samePlatformAssets.length > 0 && asset.category === "pixel") {
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
  nodes.forEach((node) => {
    nodeMap.set(node.assetId, node);
  });
  function detectCycle(nodeId: string, path: string[]): string[] | null {
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return path.slice(cycleStart).concat(nodeId);
    }
    if (visited.has(nodeId)) {
      return null;
    }
    visiting.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (node) {
      for (const depId of node.dependencies) {
        const cycle = detectCycle(depId, [...path, nodeId]);
        if (cycle) {
          visiting.delete(nodeId);
          return cycle;
        }
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  }
  nodes.forEach((node) => {
    if (!visited.has(node.assetId)) {
      const cycle = detectCycle(node.assetId, []);
      if (cycle) {
        cycles.push(cycle);
      }
    }
  });
  visited.clear();
  const inDegree = new Map<string, number>();
  nodes.forEach((node) => {
    inDegree.set(node.assetId, 0);
  });
  nodes.forEach((node) => {
    node.dependencies.forEach((depId) => {
      inDegree.set(depId, (inDegree.get(depId) || 0) + 1);
    });
  });
  const queue: string[] = [];
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      queue.push(nodeId);
    }
  });
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) break;
    order.push(nodeId);
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (node) {
      node.dependents.forEach((dependentId) => {
        const currentDegree = inDegree.get(dependentId) || 0;
        inDegree.set(dependentId, currentDegree - 1);
        if (currentDegree - 1 === 0) {
          queue.push(dependentId);
        }
      });
    }
  }
  nodes.forEach((node) => {
    if (!visited.has(node.assetId)) {
      order.push(node.assetId);
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
  await prisma.auditAsset.update({
    where: { id: assetId },
    data: {
      dependencies: dependencies,
    },
  });
}
