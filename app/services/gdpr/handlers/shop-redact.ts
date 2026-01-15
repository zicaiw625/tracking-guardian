import prisma from "../../../db.server";
import { logger } from "../../../utils/logger.server";
import type { ShopRedactPayload, ShopRedactResult } from "../types";
import { createEmptyShopRedactDeletionCounts } from "../types";

export async function processShopRedact(
  shopDomain: string,
  _payload: ShopRedactPayload
): Promise<ShopRedactResult> {
  logger.info(`[GDPR] Processing shop redact for ${shopDomain} - DELETING ALL DATA`);
  const deletedCounts = createEmptyShopRedactDeletionCounts();
  await prisma.$transaction(async (tx) => {
    const webhookLogResult = await tx.webhookLog.deleteMany({
      where: { shopDomain },
    });
    deletedCounts.webhookLogs = webhookLogResult.count;
    const gdprJobResult = await tx.gdprJob.deleteMany({
      where: { shopDomain },
    });
    deletedCounts.gdprJobs = gdprJobResult.count;
    const sessionResult = await tx.session.deleteMany({
      where: { shop: shopDomain },
    });
    deletedCounts.sessions = sessionResult.count;
    const shop = await tx.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (shop) {
      const pixelReceiptResult = await tx.pixelEventReceipt.count({
        where: { shopId: shop.id },
      });
      deletedCounts.pixelEventReceipts = pixelReceiptResult;
      const verificationRunResult = await tx.verificationRun.count({
        where: { shopId: shop.id },
      });
      deletedCounts.verificationRuns = verificationRunResult;
      const scanReportResult = await tx.scanReport.count({
        where: { shopId: shop.id },
      });
      deletedCounts.scanReports = scanReportResult;
      const auditAssetResult = await tx.auditAsset.count({
        where: { shopId: shop.id },
      });
      deletedCounts.auditAssets = auditAssetResult;
      const pixelConfigResult = await tx.pixelConfig.count({
        where: { shopId: shop.id },
      });
      deletedCounts.pixelConfigs = pixelConfigResult;
    }
    await tx.shop.deleteMany({
      where: { shopDomain },
    });
    deletedCounts.shop = 1;
  });
  const result: ShopRedactResult = {
    shopDomain,
    deletedCounts,
  };
  logger.info(`[GDPR] Shop redact completed for ${shopDomain}`, { ...deletedCounts });
  return result;
}
