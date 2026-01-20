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
    case "survey": {
      const orderTracking = allAssets.find(
        (a) => a.category === "support" && a.platform === "order_tracking"
      );
      if (orderTracking) {
        dependencies.push(orderTracking.id);
      }
      const surveyPixels = allAssets.filter(
        (a) => a.category === "pixel" && a.migrationStatus !== "completed"
      );
      if (surveyPixels.length > 0) {
        const samePlatformPixel = surveyPixels.find(
          p => p.platform === asset.platform
        );
        if (samePlatformPixel) {
          dependencies.push(samePlatformPixel.id);
        } else if (surveyPixels.length > 0) {
          dependencies.push(surveyPixels[0].id);
        }
      }
      if (asset.details && typeof asset.details === "object") {
        const details = asset.details as Record<string, unknown>;
        const requiresPixel = details.requiresPixel as boolean | undefined;
        const requiresOrderData = details.requiresOrderData as boolean | undefined;
        if (requiresPixel && surveyPixels.length > 0 && !dependencies.some(d => surveyPixels.some(p => p.id === d))) {
          dependencies.push(surveyPixels[0].id);
        }
        if (requiresOrderData && orderTracking && !dependencies.includes(orderTracking.id)) {
          dependencies.push(orderTracking.id);
        }
      }
      break;
    }
    case "affiliate": {
      const pixelAssets = allAssets.filter(
        (a) => a.category === "pixel" &&
               a.platform === asset.platform &&
               a.migrationStatus !== "completed"
      );
      if (pixelAssets.length > 0) {
        dependencies.push(pixelAssets[0].id);
      } else {
        const anyPixel = allAssets.find(
          (a) => a.category === "pixel" && a.migrationStatus !== "completed"
        );
        if (anyPixel) {
          dependencies.push(anyPixel.id);
        }
      }
      break;
    }
    case "analytics": {
      const analyticsPixels = allAssets.filter(
        (a) => a.category === "pixel" && a.migrationStatus !== "completed"
      );
      if (analyticsPixels.length > 0) {
        const criticalPlatforms = ["google", "meta", "tiktok"];
        const criticalPixel = analyticsPixels.find(
          p => p.platform && criticalPlatforms.includes(p.platform)
        );
        if (criticalPixel) {
          dependencies.push(criticalPixel.id);
        } else {
          dependencies.push(analyticsPixels[0].id);
        }
      }
      break;
    }
    case "support": {
      const supportOrderTracking = allAssets.find(
        (a) => a.category === "support" &&
               a.platform === "order_tracking" &&
               a.id !== asset.id
      );
      if (supportOrderTracking) {
        dependencies.push(supportOrderTracking.id);
      }
      break;
    }
  }
  if (asset.platform) {
    if (asset.category !== "pixel") {
      const samePlatformPixels = allAssets.filter(
        (a) => a.platform === asset.platform &&
               a.category === "pixel" &&
               a.id !== asset.id &&
               a.migrationStatus !== "completed"
      );
      if (samePlatformPixels.length > 0 && !dependencies.includes(samePlatformPixels[0].id)) {
        dependencies.push(samePlatformPixels[0].id);
      }
    }
    if (asset.details && typeof asset.details === "object") {
      const details = asset.details as Record<string, unknown>;
      const containerType = details.containerType as string | undefined;
      if (containerType === "gtm" || containerType === "tag_manager") {
        const criticalPlatforms = ["google", "meta", "tiktok"];
        for (const platform of criticalPlatforms) {
          const platformPixel = allAssets.find(
            (a) => a.platform === platform &&
                   a.category === "pixel" &&
                   a.id !== asset.id &&
                   a.migrationStatus !== "completed"
          );
          if (platformPixel && !dependencies.includes(platformPixel.id)) {
            dependencies.push(platformPixel.id);
            break;
          }
        }
      }
    }
  }
  if (asset.suggestedMigration === "server_side") {
    const relatedWebPixel = allAssets.find(
      (a) => a.platform === asset.platform &&
             a.category === asset.category &&
             a.suggestedMigration === "web_pixel" &&
             a.id !== asset.id &&
             a.migrationStatus !== "completed"
    );
    if (relatedWebPixel && !dependencies.includes(relatedWebPixel.id)) {
      dependencies.push(relatedWebPixel.id);
    }
  }
  const validDependencies = dependencies.filter(depId => {
    const depAsset = allAssets.find(a => a.id === depId);
    return depAsset && depAsset.migrationStatus !== "completed";
  });
  return [...new Set(validDependencies)];
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
      const depNode = nodes.find(n => n.assetId === depId);
      if (depNode) {
        edges.push({
          from: depId,
          to: node.assetId,
          type: "dependency",
        });
      }
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
