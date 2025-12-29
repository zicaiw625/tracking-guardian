/**
 * AuditAsset 服务层
 * 对应设计方案 4.2 Audit - 资产管理
 * 
 * 功能:
 * - 创建/更新审计资产记录
 * - 支持三种来源类型: api_scan / manual_paste / merchant_confirmed
 * - 风险评估和迁移建议
 * - 迁移状态追踪
 */

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import crypto from "crypto";

// ============================================================
// 类型定义
// ============================================================

export type AssetSourceType = "api_scan" | "manual_paste" | "merchant_confirmed";

export type AssetCategory = 
  | "pixel"      // 渠道像素 (GA4/Meta/TikTok 等)
  | "affiliate"  // 联盟/分佣
  | "survey"     // 售后问卷
  | "support"    // 客服入口
  | "analytics"  // 站内分析 (热力图/A/B)
  | "other";     // 其他

export type RiskLevel = "high" | "medium" | "low";

export type SuggestedMigration = 
  | "web_pixel"     // 迁移到 Web Pixel
  | "ui_extension"  // 迁移到 Checkout UI Extension
  | "server_side"   // 迁移到服务端 CAPI
  | "none";         // 无需迁移/保留

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
  pendingMigrations: number;
  completedMigrations: number;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 生成资产指纹（用于去重）
 */
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
    // 只使用部分 details 来生成指纹
    scriptSrc: details?.scriptSrc || "",
    detectedPatterns: details?.detectedPatterns || [],
  });
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
}

/**
 * 根据类别和平台推断迁移建议
 */
function inferSuggestedMigration(
  category: AssetCategory,
  platform?: string
): SuggestedMigration {
  switch (category) {
    case "pixel":
      // 像素类建议迁移到 Web Pixel + CAPI
      return "web_pixel";
    case "survey":
    case "support":
      // 问卷和客服建议使用 UI Extension
      return "ui_extension";
    case "analytics":
      // 站内分析可能需要单独评估
      return "none";
    case "affiliate":
      // 联盟追踪可能需要服务端
      return "server_side";
    default:
      return "none";
  }
}

/**
 * 根据平台和来源推断风险等级
 */
function inferRiskLevel(
  category: AssetCategory,
  sourceType: AssetSourceType,
  platform?: string
): RiskLevel {
  // 来自 API 扫描的 ScriptTag 风险较高（即将废弃）
  if (sourceType === "api_scan" && category === "pixel") {
    return "high";
  }
  
  // 手动粘贴的 Additional Scripts 也是高风险
  if (sourceType === "manual_paste" && category === "pixel") {
    return "high";
  }
  
  // 问卷/客服等功能类相对低风险
  if (category === "survey" || category === "support") {
    return "medium";
  }
  
  return "medium";
}

// ============================================================
// CRUD 操作
// ============================================================

/**
 * 创建审计资产记录
 */
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

    // 检查是否已存在相同指纹的记录
    const existing = await prisma.auditAsset.findUnique({
      where: { shopId_fingerprint: { shopId, fingerprint } },
    });

    if (existing) {
      // 更新现有记录
      const updated = await prisma.auditAsset.update({
        where: { id: existing.id },
        data: {
          sourceType: input.sourceType,
          category: input.category,
          platform: input.platform,
          displayName: input.displayName,
          riskLevel: input.riskLevel || inferRiskLevel(input.category, input.sourceType, input.platform),
          suggestedMigration: input.suggestedMigration || inferSuggestedMigration(input.category, input.platform),
          details: input.details as object,
          scanReportId: input.scanReportId,
        },
      });
      
      logger.info("AuditAsset updated", { id: updated.id, shopId, fingerprint });
      return mapToRecord(updated);
    }

    // 创建新记录
    const asset = await prisma.auditAsset.create({
      data: {
        shopId,
        sourceType: input.sourceType,
        category: input.category,
        platform: input.platform,
        displayName: input.displayName,
        fingerprint,
        riskLevel: input.riskLevel || inferRiskLevel(input.category, input.sourceType, input.platform),
        suggestedMigration: input.suggestedMigration || inferSuggestedMigration(input.category, input.platform),
        migrationStatus: "pending",
        details: input.details as object,
        scanReportId: input.scanReportId,
      },
    });

    logger.info("AuditAsset created", { id: asset.id, shopId, category: input.category });
    return mapToRecord(asset);
  } catch (error) {
    logger.error("Failed to create AuditAsset", { shopId, error });
    return null;
  }
}

/**
 * 批量创建审计资产（用于扫描结果）
 * 性能优化: 使用事务和批量操作
 */
export async function batchCreateAuditAssets(
  shopId: string,
  assets: AuditAssetInput[],
  scanReportId?: string
): Promise<{ created: number; updated: number; failed: number }> {
  if (assets.length === 0) {
    return { created: 0, updated: 0, failed: 0 };
  }

  let created = 0;
  let updated = 0;
  let failed = 0;

  // 性能优化: 对于大量资产，使用事务批量处理
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

            // 检查是否已存在
            const existing = await tx.auditAsset.findUnique({
              where: { shopId_fingerprint: { shopId, fingerprint } },
            });

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
                  details: input.details as object,
                  scanReportId: scanReportId || input.scanReportId,
                },
              });
              updated++;
            } else {
              await tx.auditAsset.create({
                data: {
                  shopId,
                  sourceType: input.sourceType,
                  category: input.category,
                  platform: input.platform,
                  displayName: input.displayName,
                  fingerprint,
                  riskLevel: input.riskLevel || inferRiskLevel(input.category, input.sourceType, input.platform),
                  suggestedMigration: input.suggestedMigration || inferSuggestedMigration(input.category, input.platform),
                  migrationStatus: "pending",
                  details: input.details as object,
                  scanReportId: scanReportId || input.scanReportId,
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
        timeout: 30000, // 30秒超时
      });
    } catch (error) {
      logger.error("Batch AuditAssets transaction failed", { shopId, error, count: assets.length });
      // 回退到逐个处理
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
    // 少量资产，逐个处理（保持原有逻辑）
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

  logger.info("Batch AuditAssets processed", { shopId, created, updated, failed, total: assets.length });
  return { created, updated, failed };
}

/**
 * 获取店铺的所有审计资产
 */
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
    orderBy: [
      { riskLevel: "desc" },  // 高风险优先
      { createdAt: "desc" },
    ],
    take: options.limit || 100,
  });

  return assets.map(mapToRecord);
}

/**
 * 获取审计资产统计摘要
 */
export async function getAuditAssetSummary(shopId: string): Promise<AuditAssetSummary> {
  const [categoryStats, riskStats, migrationStats] = await Promise.all([
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

  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
  const pendingMigrations = byMigrationStatus.pending + byMigrationStatus.in_progress;
  const completedMigrations = byMigrationStatus.completed;

  return {
    total,
    byCategory,
    byRiskLevel,
    byMigrationStatus,
    pendingMigrations,
    completedMigrations,
  };
}

/**
 * 更新迁移状态
 */
export async function updateMigrationStatus(
  assetId: string,
  status: MigrationStatus
): Promise<boolean> {
  try {
    await prisma.auditAsset.update({
      where: { id: assetId },
      data: {
        migrationStatus: status,
        migratedAt: status === "completed" ? new Date() : null,
      },
    });
    
    logger.info("AuditAsset migration status updated", { assetId, status });
    return true;
  } catch (error) {
    logger.error("Failed to update AuditAsset migration status", { assetId, error });
    return false;
  }
}

/**
 * 批量更新迁移状态
 */
export async function batchUpdateMigrationStatus(
  assetIds: string[],
  status: MigrationStatus
): Promise<number> {
  const result = await prisma.auditAsset.updateMany({
    where: { id: { in: assetIds } },
    data: {
      migrationStatus: status,
      migratedAt: status === "completed" ? new Date() : null,
    },
  });

  logger.info("Batch migration status updated", { count: result.count, status });
  return result.count;
}

/**
 * 删除审计资产
 */
export async function deleteAuditAsset(assetId: string): Promise<boolean> {
  try {
    await prisma.auditAsset.delete({
      where: { id: assetId },
    });
    return true;
  } catch (error) {
    logger.error("Failed to delete AuditAsset", { assetId, error });
    return false;
  }
}

/**
 * 清理指定扫描报告关联的资产（用于重新扫描）
 */
export async function clearAssetsForScan(
  shopId: string,
  scanReportId: string
): Promise<number> {
  const result = await prisma.auditAsset.deleteMany({
    where: {
      shopId,
      scanReportId,
      sourceType: "api_scan",  // 只清理自动扫描的，保留手动添加的
    },
  });

  logger.info("Cleared AuditAssets for scan", { shopId, scanReportId, count: result.count });
  return result.count;
}

// ============================================================
// 辅助映射函数
// ============================================================

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

