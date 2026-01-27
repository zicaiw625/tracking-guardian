import crypto, { randomUUID } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export type AssetSourceType = "api_scan" | "manual_paste" | "merchant_confirmed";

export type AssetCategory =
  | "pixel"
  | "affiliate"
  | "survey"
  | "support"
  | "analytics"
  | "other";

export type RiskLevel = "high" | "medium" | "low";

export type SuggestedMigration =
  | "web_pixel"
  | "ui_extension"
  | "server_side"
  | "none";

export type MigrationStatus = "pending" | "in_progress" | "completed" | "skipped";

export interface AuditAssetInput {
  sourceType: AssetSourceType;
  category: AssetCategory;
  platform?: string;
  displayName?: string;
  riskLevel?: RiskLevel;
  suggestedMigration?: SuggestedMigration;
  details?: Record<string, unknown>;
  scanReportId?: string;
}

export interface AuditAssetRecord {
  id: string;
  shopId: string;
  sourceType: AssetSourceType;
  category: AssetCategory;
  platform: string | null;
  displayName: string | null;
  fingerprint: string | null;
  riskLevel: RiskLevel;
  suggestedMigration: SuggestedMigration;
  migrationStatus: MigrationStatus;
  migratedAt: Date | null;
  details: Record<string, unknown> | null;
  scanReportId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditAssetSummary {
  total: number;
  byCategory: Record<AssetCategory, number>;
  byRiskLevel: Record<RiskLevel, number>;
  byMigrationStatus: Record<MigrationStatus, number>;
  byPlatform?: Record<string, number>;
  pendingMigrations: number;
  completedMigrations: number;
}

function generateFingerprint(
  sourceType: AssetSourceType,
  category: AssetCategory,
  platform?: string,
  details?: Record<string, unknown>
): string {
  const content = JSON.stringify({
    sourceType,
    category,
    platform: platform || "",
    scriptSrc: details?.scriptSrc || "",
    detectedPatterns: details?.detectedPatterns || [],
  });
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
}

function inferSuggestedMigration(
  category: AssetCategory,
  _platform?: string
): SuggestedMigration {
  switch (category) {
    case "pixel":
      return "web_pixel";
    case "survey":
    case "support":
      return "ui_extension";
    case "analytics":
      return "none";
    case "affiliate":
      return "server_side";
    default:
      return "none";
  }
}

async function calculatePriorityAndTimeEstimate(
  assetId: string,
  shopId: string
): Promise<void> {
  try {
    const { calculatePriority, updateAssetPriority } = await import("./scanner/priority-calculator");
    const asset = await prisma.auditAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) {
      logger.warn("Asset not found for priority calculation", { assetId });
      return;
    }
    const allAssets = await prisma.auditAsset.findMany({
      where: { shopId },
    });
    const priorityResult = await calculatePriority(asset, allAssets);
    await updateAssetPriority(assetId, priorityResult);
    logger.info("Priority and time estimate calculated", {
      assetId,
      priority: priorityResult.priority,
      estimatedTimeMinutes: priorityResult.estimatedTimeMinutes,
    });
  } catch (error) {
    logger.error("Failed to calculate priority/time estimate", { assetId, error });
    throw error;
  }
}

function inferRiskLevel(
  category: AssetCategory,
  sourceType: AssetSourceType,
  _platform?: string
): RiskLevel {
  if (sourceType === "api_scan" && category === "pixel") {
    return "high";
  }
  if (sourceType === "manual_paste" && category === "pixel") {
    return "high";
  }
  if (category === "survey" || category === "support") {
    return "medium";
  }
  return "medium";
}

export async function createAuditAsset(
  shopId: string,
  input: AuditAssetInput
): Promise<AuditAssetRecord | null> {
  try {
    const fingerprint = generateFingerprint(
      input.sourceType,
      input.category,
      input.platform,
      input.details
    );
    const existing = await prisma.auditAsset.findUnique({
      where: { shopId_fingerprint: { shopId, fingerprint } },
      select: {
        id: true,
        shopId: true,
        sourceType: true,
        category: true,
        platform: true,
        displayName: true,
        fingerprint: true,
        riskLevel: true,
        suggestedMigration: true,
        migrationStatus: true,
        migratedAt: true,
        details: true,
        scanReportId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (existing) {
      const detailsForStorage: Record<string, unknown> = { ...input.details };
      delete detailsForStorage.content;
      const updated = await prisma.auditAsset.update({
        where: { id: existing.id },
        data: {
          sourceType: input.sourceType,
          category: input.category,
          platform: input.platform,
          displayName: input.displayName,
          riskLevel: input.riskLevel || inferRiskLevel(input.category, input.sourceType, input.platform),
          suggestedMigration: input.suggestedMigration || inferSuggestedMigration(input.category, input.platform),
          details: detailsForStorage as object,
          scanReportId: input.scanReportId,
        },
        select: {
          id: true,
          shopId: true,
          sourceType: true,
          category: true,
          platform: true,
          displayName: true,
          fingerprint: true,
          riskLevel: true,
          suggestedMigration: true,
          migrationStatus: true,
          migratedAt: true,
          details: true,
          scanReportId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      calculatePriorityAndTimeEstimate(updated.id, shopId).catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Failed to calculate priority/time estimate asynchronously", error instanceof Error ? error : new Error(String(error)), {
          assetId: updated.id,
          shopId,
          errorMessage,
        });
      });
      logger.info("AuditAsset updated", { id: updated.id, shopId, fingerprint });
      return mapToRecord(updated);
    }
    const detailsForStorage: Record<string, unknown> = { ...input.details };
    delete detailsForStorage.content;
    const asset = await prisma.auditAsset.create({
      data: {
        id: randomUUID(),
        shopId,
        sourceType: input.sourceType,
        category: input.category,
        platform: input.platform,
        displayName: input.displayName,
        fingerprint,
        riskLevel: input.riskLevel || inferRiskLevel(input.category, input.sourceType, input.platform),
        suggestedMigration: input.suggestedMigration || inferSuggestedMigration(input.category, input.platform),
        migrationStatus: "pending",
        details: detailsForStorage as object,
        scanReportId: input.scanReportId,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        shopId: true,
        sourceType: true,
        category: true,
        platform: true,
        displayName: true,
        fingerprint: true,
        riskLevel: true,
        suggestedMigration: true,
        migrationStatus: true,
        migratedAt: true,
        details: true,
        scanReportId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    calculatePriorityAndTimeEstimate(asset.id, shopId).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to calculate priority/time estimate asynchronously", error instanceof Error ? error : new Error(String(error)), {
        assetId: asset.id,
        shopId,
        errorMessage,
      });
    });
    logger.info("AuditAsset created", { id: asset.id, shopId, category: input.category });
    return mapToRecord(asset);
  } catch (error) {
    logger.error("Failed to create AuditAsset", { shopId, error });
    return null;
  }
}

export async function batchCreateAuditAssets(
  shopId: string,
  assets: AuditAssetInput[],
  scanReportId?: string
): Promise<{ created: number; updated: number; failed: number; duplicates?: number }> {
  if (assets.length === 0) {
    return { created: 0, updated: 0, failed: 0, duplicates: 0 };
  }
  let created = 0;
  let updated = 0;
  let failed = 0;
  const duplicates = 0;
  if (assets.length > 50) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const input of assets) {
          try {
            const fingerprint = generateFingerprint(
              input.sourceType,
              input.category,
              input.platform,
              input.details
            );
            const existing = await tx.auditAsset.findUnique({
              where: { shopId_fingerprint: { shopId, fingerprint } },
            });
            const detailsForStorage: Record<string, unknown> = { ...input.details };
            delete detailsForStorage.content;
            if (existing) {
              await tx.auditAsset.update({
                where: { id: existing.id },
                data: {
                  sourceType: input.sourceType,
                  category: input.category,
                  platform: input.platform,
                  displayName: input.displayName,
                  riskLevel: input.riskLevel || inferRiskLevel(input.category, input.sourceType, input.platform),
                  suggestedMigration: input.suggestedMigration || inferSuggestedMigration(input.category, input.platform),
                  details: detailsForStorage as object,
                  scanReportId: scanReportId || input.scanReportId,
                },
              });
              updated++;
            } else {
              await tx.auditAsset.create({
                data: {
                  id: randomUUID(),
                  shopId,
                  sourceType: input.sourceType,
                  category: input.category,
                  platform: input.platform,
                  displayName: input.displayName,
                  fingerprint,
                  riskLevel: input.riskLevel || inferRiskLevel(input.category, input.sourceType, input.platform),
                  suggestedMigration: input.suggestedMigration || inferSuggestedMigration(input.category, input.platform),
                  migrationStatus: "pending",
                  details: detailsForStorage as object,
                  scanReportId: scanReportId || input.scanReportId,
                  updatedAt: new Date(),
                },
              });
              created++;
            }
          } catch (error) {
            failed++;
            logger.warn("Failed to create/update AuditAsset in batch", { shopId, error });
          }
        }
      }, {
        timeout: 30000,
      });
    } catch (error) {
      logger.error("Batch AuditAssets transaction failed", { shopId, error, count: assets.length });
      for (const input of assets) {
        const result = await createAuditAsset(shopId, {
          ...input,
          scanReportId: scanReportId || input.scanReportId,
        });
        if (result) {
          const isNew = Date.now() - result.createdAt.getTime() < 1000;
          if (isNew) {
            created++;
          } else {
            updated++;
          }
        } else {
          failed++;
        }
      }
    }
  } else {
    for (const input of assets) {
      const result = await createAuditAsset(shopId, {
        ...input,
        scanReportId: scanReportId || input.scanReportId,
      });
      if (result) {
        const isNew = Date.now() - result.createdAt.getTime() < 1000;
        if (isNew) {
          created++;
        } else {
          updated++;
        }
      } else {
        failed++;
      }
    }
  }
  logger.info("Batch AuditAssets processed", { shopId, created, updated, failed, duplicates, total: assets.length });
  return { created, updated, failed, duplicates };
}


export async function getAuditAssets(
  shopId: string,
  options: {
    category?: AssetCategory;
    riskLevel?: RiskLevel;
    migrationStatus?: MigrationStatus;
    limit?: number;
  } = {}
): Promise<AuditAssetRecord[]> {
  const assets = await prisma.auditAsset.findMany({
    where: {
      shopId,
      ...(options.category && { category: options.category }),
      ...(options.riskLevel && { riskLevel: options.riskLevel }),
      ...(options.migrationStatus && { migrationStatus: options.migrationStatus }),
    },
    select: {
      id: true,
      shopId: true,
      sourceType: true,
      category: true,
      platform: true,
      displayName: true,
      fingerprint: true,
      riskLevel: true,
      suggestedMigration: true,
      migrationStatus: true,
      migratedAt: true,
      details: true,
      scanReportId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [
      { riskLevel: "desc" },
      { createdAt: "desc" },
    ],
    take: options.limit || 100,
  });
  return assets.map(mapToRecord);
}

export async function getAuditAssetSummary(shopId: string): Promise<AuditAssetSummary> {
  const [categoryStats, riskStats, migrationStats, platformStats] = await Promise.all([
    prisma.auditAsset.groupBy({
      by: ["category"],
      where: { shopId },
      _count: true,
    }),
    prisma.auditAsset.groupBy({
      by: ["riskLevel"],
      where: { shopId },
      _count: true,
    }),
    prisma.auditAsset.groupBy({
      by: ["migrationStatus"],
      where: { shopId },
      _count: true,
    }),
    prisma.auditAsset.groupBy({
      by: ["platform"],
      where: {
        shopId,
        platform: { not: null },
      },
      _count: true,
    }),
  ]);
  const byCategory: Record<AssetCategory, number> = {
    pixel: 0,
    affiliate: 0,
    survey: 0,
    support: 0,
    analytics: 0,
    other: 0,
  };
  categoryStats.forEach(s => {
    byCategory[s.category as AssetCategory] = s._count;
  });
  const byRiskLevel: Record<RiskLevel, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  riskStats.forEach(s => {
    byRiskLevel[s.riskLevel as RiskLevel] = s._count;
  });
  const byMigrationStatus: Record<MigrationStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    skipped: 0,
  };
  migrationStats.forEach(s => {
    byMigrationStatus[s.migrationStatus as MigrationStatus] = s._count;
  });
  const byPlatform: Record<string, number> = {};
  platformStats.forEach(s => {
    if (s.platform) {
      byPlatform[s.platform] = s._count;
    }
  });
  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
  const pendingMigrations = byMigrationStatus.pending + byMigrationStatus.in_progress;
  const completedMigrations = byMigrationStatus.completed;
  return {
    total,
    byCategory,
    byRiskLevel,
    byMigrationStatus,
    byPlatform,
    pendingMigrations,
    completedMigrations,
  };
}

export async function updateMigrationStatus(
  shopId: string,
  assetId: string,
  status: MigrationStatus
): Promise<boolean> {
  try {
    const res = await prisma.auditAsset.updateMany({
      where: { id: assetId, shopId },
      data: {
        migrationStatus: status,
        migratedAt: status === "completed" ? new Date() : null,
      },
    });
    const success = res.count === 1;
    if (success) {
      logger.info("AuditAsset migration status updated", { shopId, assetId, status });
    } else {
      logger.warn("AuditAsset migration status update failed - asset not found or shop mismatch", { shopId, assetId, status });
    }
    return success;
  } catch (error) {
    logger.error("Failed to update AuditAsset migration status", { shopId, assetId, error });
    return false;
  }
}

export async function batchUpdateMigrationStatus(
  shopId: string,
  assetIds: string[],
  status: MigrationStatus
): Promise<number> {
  const result = await prisma.auditAsset.updateMany({
    where: { id: { in: assetIds }, shopId },
    data: {
      migrationStatus: status,
      migratedAt: status === "completed" ? new Date() : null,
    },
  });
  logger.info("Batch migration status updated", { shopId, count: result.count, status });
  return result.count;
}

export async function deleteAuditAsset(shopId: string, assetId: string): Promise<boolean> {
  try {
    const res = await prisma.auditAsset.deleteMany({
      where: { id: assetId, shopId },
    });
    const success = res.count === 1;
    if (success) {
      logger.info("AuditAsset deleted", { shopId, assetId });
    } else {
      logger.warn("AuditAsset delete failed - asset not found or shop mismatch", { shopId, assetId });
    }
    return success;
  } catch (error) {
    logger.error("Failed to delete AuditAsset", { shopId, assetId, error });
    return false;
  }
}

export async function clearAssetsForScan(
  shopId: string,
  scanReportId: string
): Promise<number> {
  const result = await prisma.auditAsset.deleteMany({
    where: {
      shopId,
      scanReportId,
      sourceType: "api_scan",
    },
  });
  logger.info("Cleared AuditAssets for scan", { shopId, scanReportId, count: result.count });
  return result.count;
}

function mapToRecord(asset: {
  id: string;
  shopId: string;
  sourceType: string;
  category: string;
  platform: string | null;
  displayName: string | null;
  fingerprint: string | null;
  riskLevel: string;
  suggestedMigration: string;
  migrationStatus: string;
  migratedAt: Date | null;
  details: unknown;
  scanReportId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AuditAssetRecord {
  return {
    id: asset.id,
    shopId: asset.shopId,
    sourceType: asset.sourceType as AssetSourceType,
    category: asset.category as AssetCategory,
    platform: asset.platform,
    displayName: asset.displayName,
    fingerprint: asset.fingerprint,
    riskLevel: asset.riskLevel as RiskLevel,
    suggestedMigration: asset.suggestedMigration as SuggestedMigration,
    migrationStatus: asset.migrationStatus as MigrationStatus,
    migratedAt: asset.migratedAt,
    details: asset.details as Record<string, unknown> | null,
    scanReportId: asset.scanReportId,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}
