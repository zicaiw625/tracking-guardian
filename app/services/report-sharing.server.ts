
import prisma from "../db.server";
import { randomBytes } from "crypto";
import { logger } from "../utils/logger.server";
import type { Prisma } from "@prisma/client";

export interface ShareableReport {
  id: string;
  shopId: string;
  reportType: "verification" | "scan" | "reconciliation" | "migration";
  reportId: string;
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
  expiresInDays?: number;
  metadata?: Record<string, unknown>;
}

export interface ShareableReportResult {
  shareUrl: string;
  shareToken: string;
  expiresAt: Date;
}

export async function createShareableReport(
  options: CreateShareableReportOptions
): Promise<ShareableReportResult> {
  const { shopId, reportType, reportId, expiresInDays = 7, metadata } = options;

  const shareToken = randomBytes(32).toString("hex");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  try {

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, settings: true },
    });

    if (!shop) {
      throw new Error("Shop not found");
    }

    const shopSettings = (shop.settings as Record<string, unknown> | null) || {};
    const existingReports = (shopSettings.shareableReports as Array<ShareableReport> | null) || [];

    const existing = existingReports.find(
      (r) =>
        r.reportType === reportType &&
        r.reportId === reportId &&
        new Date(r.expiresAt) > new Date()
    );

    if (existing) {

      const updatedReports = existingReports.map((r) =>
        r.id === existing.id
          ? { ...r, expiresAt, metadata: metadata || r.metadata }
          : r
      );

      await prisma.shop.update({
        where: { id: shopId },
        data: { settings: ({ ...shopSettings, shareableReports: updatedReports } as unknown) as Prisma.InputJsonValue },
      });

      const baseUrl = process.env.SHOPIFY_APP_URL || process.env.PUBLIC_APP_URL || "";
      const shareUrl = `${baseUrl}/api/reports/share/${existing.shareToken}`;

      return {
        shareUrl,
        shareToken: existing.shareToken,
        expiresAt,
      };
    }

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
        data: { settings: ({ ...shopSettings, shareableReports: updatedReports } as unknown) as Prisma.InputJsonValue },
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

export async function getShareableReport(
  shareToken: string
): Promise<ShareableReport | null> {
  try {

    const shops = await prisma.shop.findMany({
      select: { id: true, settings: true },
    });

    for (const shop of shops) {
      const shopSettings = (shop.settings as Record<string, unknown> | null) || {};
      const reports = (shopSettings.shareableReports as Array<ShareableReport> | null) || [];
      const report = reports.find((r) => r.shareToken === shareToken);

      if (report) {

        if (new Date(report.expiresAt) < new Date()) {
          return null;
        }

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
          data: { settings: ({ ...shopSettings, shareableReports: updatedReports } as unknown) as Prisma.InputJsonValue },
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
          data: { settings: ({ ...shopSettings, shareableReports: activeReports } as unknown) as Prisma.InputJsonValue },
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

    return reports.filter((r) => new Date(r.expiresAt) > new Date());
  } catch (error) {
    logger.error("Failed to get shop shareable reports", { error, shopId });
    return [];
  }
}

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
        data: { settings: ({ ...shopSettings, shareableReports: updatedReports } as unknown) as Prisma.InputJsonValue },
    });

    logger.info("Shareable report deleted", { shopId, shareToken });
    return true;
  } catch (error) {
    logger.error("Failed to delete shareable report", { error, shopId, shareToken });
    return false;
  }
}

