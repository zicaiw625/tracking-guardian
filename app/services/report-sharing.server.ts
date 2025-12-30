
import prisma from "../db.server";
import { randomBytes } from "crypto";
import { logger } from "../utils/logger.server";

export interface ShareableReport {
  id: string;
  shopId: string;
  reportType: "verification" | "scan" | "reconciliation" | "migration";
  reportId: string; // runId, scanReportId, etc.
  shareToken: string;
  expiresAt: Date;
  createdAt: Date;
  accessedAt?: Date;
  accessCount: number;
  metadata?: Record<string, unknown>;
}

export interface CreateShareableReportOptions {
  shopId: string;
  reportType: "verification" | "scan" | "reconciliation" | "migration";
  reportId: string;
  expiresInDays?: number; // 默认 7 天
  metadata?: Record<string, unknown>;
}

export interface ShareableReportResult {
  shareUrl: string;
  shareToken: string;
  expiresAt: Date;
}

/**
 * 创建可分享的报告链接
 * 使用 Shop 表的 JSON 字段存储分享信息（如果 ShareableReport 表不存在）
 */
export async function createShareableReport(
  options: CreateShareableReportOptions
): Promise<ShareableReportResult> {
  const { shopId, reportType, reportId, expiresInDays = 7, metadata } = options;

  // 生成唯一的分享 token
  const shareToken = randomBytes(32).toString("hex");

  // 计算过期时间
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  try {
    // 从 Shop 表获取或创建分享链接存储（使用 settings JSON 字段）
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, settings: true },
    });

    if (!shop) {
      throw new Error("Shop not found");
    }

    // 获取现有的分享链接（存储在 settings JSON 字段中）
    const shopSettings = (shop.settings as Record<string, unknown> | null) || {};
    const existingReports = (shopSettings.shareableReports as Array<ShareableReport> | null) || [];
    
    // 检查是否已存在未过期的分享链接
    const existing = existingReports.find(
      (r) =>
        r.reportType === reportType &&
        r.reportId === reportId &&
        new Date(r.expiresAt) > new Date()
    );

    if (existing) {
      // 如果已存在，更新过期时间
      const updatedReports = existingReports.map((r) =>
        r.id === existing.id
          ? { ...r, expiresAt, metadata: metadata || r.metadata }
          : r
      );

      await prisma.shop.update({
        where: { id: shopId },
        data: { settings: { ...shopSettings, shareableReports: updatedReports } },
      });

      const baseUrl = process.env.SHOPIFY_APP_URL || process.env.PUBLIC_APP_URL || "";
      const shareUrl = `${baseUrl}/api/reports/share/${existing.shareToken}`;

      return {
        shareUrl,
        shareToken: existing.shareToken,
        expiresAt,
      };
    }

    // 创建新的分享链接
    const newReport: ShareableReport = {
      id: randomBytes(16).toString("hex"),
      shopId,
      reportType,
      reportId,
      shareToken,
      expiresAt,
      createdAt: new Date(),
      accessCount: 0,
      metadata,
    };

    const updatedReports = [...existingReports, newReport];

    await prisma.shop.update({
      where: { id: shopId },
      data: { settings: { ...shopSettings, shareableReports: updatedReports } },
    });

    const baseUrl = process.env.SHOPIFY_APP_URL || process.env.PUBLIC_APP_URL || "";
    const shareUrl = `${baseUrl}/api/reports/share/${shareToken}`;

    logger.info("Shareable report created", {
      shopId,
      reportType,
      reportId,
      shareToken,
      expiresAt,
    });

    return {
      shareUrl,
      shareToken,
      expiresAt,
    };
  } catch (error) {
    logger.error("Failed to create shareable report", { error, options });
    throw new Error("创建分享链接失败");
  }
}

/**
 * 获取分享的报告信息
 */
export async function getShareableReport(
  shareToken: string
): Promise<ShareableReport | null> {
  try {
    // 在所有 Shop 中查找分享链接
    const shops = await prisma.shop.findMany({
      select: { id: true, settings: true },
    });

    for (const shop of shops) {
      const shopSettings = (shop.settings as Record<string, unknown> | null) || {};
      const reports = (shopSettings.shareableReports as Array<ShareableReport> | null) || [];
      const report = reports.find((r) => r.shareToken === shareToken);

      if (report) {
        // 检查是否过期
        if (new Date(report.expiresAt) < new Date()) {
          return null; // 已过期
        }

        // 更新访问时间和访问次数
        const updatedReports = reports.map((r) =>
          r.shareToken === shareToken
            ? {
                ...r,
                accessedAt: new Date(),
                accessCount: (r.accessCount || 0) + 1,
              }
            : r
        );

        await prisma.shop.update({
          where: { id: shop.id },
          data: { settings: { ...shopSettings, shareableReports: updatedReports } },
        });

        return {
          ...report,
          accessedAt: new Date(),
          accessCount: (report.accessCount || 0) + 1,
        };
      }
    }

    return null;
  } catch (error) {
    logger.error("Failed to get shareable report", { error, shareToken });
    return null;
  }
}

/**
 * 记录分享链接的访问
 */
export async function recordShareAccess(shareToken: string): Promise<void> {
  try {
    const report = await getShareableReport(shareToken);
    if (report) {
      logger.info("Share access recorded", { shareToken, accessCount: report.accessCount });
    }
  } catch (error) {
    logger.error("Failed to record share access", { error, shareToken });
  }
}

/**
 * 删除过期的分享链接
 */
export async function cleanupExpiredShares(): Promise<number> {
  try {
    const shops = await prisma.shop.findMany({
      select: { id: true, settings: true },
    });

    let cleanedCount = 0;

    for (const shop of shops) {
      const shopSettings = (shop.settings as Record<string, unknown> | null) || {};
      const reports = (shopSettings.shareableReports as Array<ShareableReport> | null) || [];
      const activeReports = reports.filter(
        (r) => new Date(r.expiresAt) > new Date()
      );

      if (activeReports.length !== reports.length) {
        await prisma.shop.update({
          where: { id: shop.id },
          data: { settings: { ...shopSettings, shareableReports: activeReports } },
        });
        cleanedCount += reports.length - activeReports.length;
      }
    }

    logger.info("Expired shares cleaned up", { cleanedCount });
    return cleanedCount;
  } catch (error) {
    logger.error("Failed to cleanup expired shares", { error });
    return 0;
  }
}

/**
 * 获取店铺的所有分享链接
 */
export async function getShopShareableReports(
  shopId: string
): Promise<ShareableReport[]> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { settings: true },
    });

    if (!shop) {
      return [];
    }

    const shopSettings = (shop.settings as Record<string, unknown> | null) || {};
    const reports = (shopSettings.shareableReports as Array<ShareableReport> | null) || [];
    // 只返回未过期的链接
    return reports.filter((r) => new Date(r.expiresAt) > new Date());
  } catch (error) {
    logger.error("Failed to get shop shareable reports", { error, shopId });
    return [];
  }
}

/**
 * 删除分享链接
 */
export async function deleteShareableReport(
  shopId: string,
  shareToken: string
): Promise<boolean> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { settings: true },
    });

    if (!shop) {
      return false;
    }

    const shopSettings = (shop.settings as Record<string, unknown> | null) || {};
    const reports = (shopSettings.shareableReports as Array<ShareableReport> | null) || [];
    const updatedReports = reports.filter((r) => r.shareToken !== shareToken);

    await prisma.shop.update({
      where: { id: shopId },
      data: { settings: { ...shopSettings, shareableReports: updatedReports } },
    });

    logger.info("Shareable report deleted", { shopId, shareToken });
    return true;
  } catch (error) {
    logger.error("Failed to delete shareable report", { error, shopId, shareToken });
    return false;
  }
}

