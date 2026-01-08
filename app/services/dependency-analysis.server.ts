import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";

export interface DependencyGraph {
  nodes: Array<{
    id: string;
    assetId: string;
    platform: string | null;
    category: string;
    riskLevel: string;
    priority: number | null;
    estimatedTimeMinutes: number | null;
    displayName: string | null;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: "depends_on" | "blocks" | "recommended_after";
    reason: string;
  }>;
}

export async function analyzeDependencies(
  shopId: string
): Promise<DependencyGraph> {
  const assets = await prisma.auditAsset.findMany({
    where: {
      shopId,
      migrationStatus: { not: "completed" },
    },
    select: {
      id: true,
      platform: true,
      category: true,
      riskLevel: true,
      priority: true,
      estimatedTimeMinutes: true,
      suggestedMigration: true,
      dependencies: true,
      displayName: true,
    },
  });

  const nodes = assets.map((asset) => ({
    id: `asset-${asset.id}`,
    assetId: asset.id,
    platform: asset.platform,
    category: asset.category,
    riskLevel: asset.riskLevel,
    priority: asset.priority,
    estimatedTimeMinutes: asset.estimatedTimeMinutes,
    displayName: asset.displayName,
  }));

  const edges: DependencyGraph["edges"] = [];

  assets.forEach((asset) => {
    if (asset.dependencies && Array.isArray(asset.dependencies)) {
      const deps = asset.dependencies as string[];
      deps.forEach((depId) => {
        const depAsset = assets.find((a) => a.id === depId);
        if (depAsset) {
          edges.push({
            from: `asset-${depId}`,
            to: `asset-${asset.id}`,
            type: "depends_on",
            reason: "显式依赖关系",
          });
        }
      });
    }
  });

  assets.forEach((asset) => {
    if (asset.platform && asset.riskLevel === "high") {
      const samePlatformLowRisk = assets.filter(
        (a) =>
          a.id !== asset.id &&
          a.platform === asset.platform &&
          a.riskLevel === "low"
      );

      samePlatformLowRisk.forEach((lowRiskAsset) => {
        edges.push({
          from: `asset-${asset.id}`,
          to: `asset-${lowRiskAsset.id}`,
          type: "recommended_after",
          reason: "相同平台，高风险应优先处理",
        });
      });
    }
  });

  const webPixelAssets = assets.filter(
    (a) => a.suggestedMigration === "web_pixel"
  );
  const uiExtensionAssets = assets.filter(
    (a) => a.suggestedMigration === "ui_extension"
  );

  webPixelAssets.forEach((webPixelAsset) => {
    uiExtensionAssets.forEach((uiExtensionAsset) => {
      if (webPixelAsset.platform === uiExtensionAsset.platform) {
        edges.push({
          from: `asset-${webPixelAsset.id}`,
          to: `asset-${uiExtensionAsset.id}`,
          type: "recommended_after",
          reason: "UI 扩展可能依赖像素数据",
        });
      }
    });
  });

  return { nodes, edges };
}

export async function generateMigrationOrder(
  shopId: string
): Promise<Array<{
  assetId: string;
  order: number;
  reason: string;
  dependencies: string[];
}>> {
  const graph = await analyzeDependencies(shopId);

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  graph.nodes.forEach((node) => {
    inDegree.set(node.id, 0);
    dependents.set(node.id, []);
  });

  graph.edges.forEach((edge) => {
    if (edge.type === "depends_on") {
      const current = inDegree.get(edge.to) || 0;
      inDegree.set(edge.to, current + 1);

      const deps = dependents.get(edge.from) || [];
      deps.push(edge.to);
      dependents.set(edge.from, deps);
    }
  });

  const ordered: Array<{
    assetId: string;
    order: number;
    reason: string;
    dependencies: string[];
  }> = [];

  const processed = new Set<string>();
  let currentOrder = 1;

  const noDependencyNodes = graph.nodes.filter(
    (node) => (inDegree.get(node.id) || 0) === 0
  );

  noDependencyNodes.sort((a, b) => {
    const priorityA = a.priority || 0;
    const priorityB = b.priority || 0;
    if (priorityA !== priorityB) {
      return priorityB - priorityA;
    }

    const riskOrder = { high: 3, medium: 2, low: 1 };
    return (
      riskOrder[b.riskLevel as keyof typeof riskOrder] -
      riskOrder[a.riskLevel as keyof typeof riskOrder]
    );
  });

  const queue = [...noDependencyNodes];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || processed.has(node.id)) continue;

    const asset = await prisma.auditAsset.findUnique({
      where: { id: node.assetId },
      select: { dependencies: true },
    });

    const dependencies = asset?.dependencies
      ? (asset.dependencies as string[])
      : [];

    ordered.push({
      assetId: node.assetId,
      order: currentOrder++,
      reason: `优先级 ${node.priority || "N/A"}，${node.riskLevel} 风险`,
      dependencies,
    });

    processed.add(node.id);

    const dependentsList = dependents.get(node.id) || [];
    dependentsList.forEach((dependentId) => {
      const current = inDegree.get(dependentId) || 0;
      inDegree.set(dependentId, Math.max(0, current - 1));

      if (inDegree.get(dependentId) === 0) {
        const dependentNode = graph.nodes.find((n) => n.id === dependentId);
        if (dependentNode && !processed.has(dependentId)) {
          queue.push(dependentNode);
        }
      }
    });
  }

  for (const node of graph.nodes) {
    if (!processed.has(node.id)) {
      const asset = await prisma.auditAsset.findUnique({
        where: { id: node.assetId },
        select: { dependencies: true },
      });

      const dependencies = asset?.dependencies
        ? (asset.dependencies as string[])
        : [];

      ordered.push({
        assetId: node.assetId,
        order: currentOrder++,
        reason: "独立项或循环依赖",
        dependencies,
      });
    }
  }

  return ordered;
}
