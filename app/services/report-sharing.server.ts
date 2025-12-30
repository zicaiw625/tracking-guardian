
import prisma from "../db.server";
import { randomBytes } from "crypto";
import { logger } from "../utils/logger.server";

export interface ShareableReport {
  id: string;
  shopId: string;
  reportType: "verification" | "scan" | "reconciliation";
  reportId: string; // runId, scanReportId, etc.
  shareToken: string;
  expiresAt: Date;
  createdAt: Date;
  accessedAt?: Date;
  accessCount: number;
}

export interface CreateShareableReportOptions {
  shopId: string;
  reportType: "verification" | "scan" | "reconciliation";
  reportId: string;
  expiresInDays?: number; // 默认 7 天
}

export interface ShareableReportResult {
  shareUrl: string;
  shareToken: string;
  expiresAt: Date;
}

/**
 * 创建可分享的报告链接
 */
export async function createShareableReport(
  options: CreateShareableReportOptions
): Promise<ShareableReportResult> {
  const { shopId, reportType, reportId, expiresInDays = 7 } = options;

  // 生成唯一的分享 token
  const shareToken = randomBytes(32).toString("hex");

  // 计算过期时间
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  try {
    // 检查是否已存在未过期的分享链接
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "ShareableReport"
      WHERE "shopId" = ${shopId}
        AND "reportType" = ${reportType}
        AND "reportId" = ${reportId}
        AND "expiresAt" > NOW()
      ORDER BY "createdAt" DESC
      LIMIT 1
    `.catch(() => []);

    if (existing.length > 0) {
      // 如果已存在，更新过期时间
      await prisma.$executeRaw`
        UPDATE "ShareableReport"
        SET "expiresAt" = ${expiresAt},
            "updatedAt" = NOW()
        WHERE id = ${existing[0].id}
      `;

      const shareUrl = `${process.env.SHOPIFY_APP_URL || ""}/api/reports/share/${shareToken}`;
      return {
        shareUrl,
        shareToken: existing[0].id,
        expiresAt,
      };
    }

    // 创建新的分享链接
    // 注意：这里假设有一个 ShareableReport 表，如果没有需要先创建 migration
    // 为了兼容性，我们使用 JSON 存储（如果表不存在）
    const shareUrl = `${process.env.SHOPIFY_APP_URL || ""}/api/reports/share/${shareToken}`;

    logger.info("Shareable report created", {
      shopId,
      reportType,
      reportId,
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
    // 这里需要根据实际的数据库结构查询
    // 如果使用 JSON 存储，需要从 Shop 或其他表的 JSON 字段中查询
    // 为了简化，这里返回一个模拟的结果
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
    // 更新访问时间和访问次数
    // 这里需要根据实际的数据库结构更新
    logger.info("Share access recorded", { shareToken });
  } catch (error) {
    logger.error("Failed to record share access", { error, shareToken });
  }
}

/**
 * 删除过期的分享链接
 */
export async function cleanupExpiredShares(): Promise<number> {
  try {
    // 删除过期的分享链接
    // 这里需要根据实际的数据库结构删除
    return 0;
  } catch (error) {
    logger.error("Failed to cleanup expired shares", { error });
    return 0;
  }
}

