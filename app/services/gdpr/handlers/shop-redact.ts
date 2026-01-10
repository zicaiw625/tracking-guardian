import prisma from "../../../db.server";
import { logger } from "../../../utils/logger.server";
import type { ShopRedactPayload, ShopRedactResult } from "../types";
import { createEmptyShopRedactDeletionCounts } from "../types";

export async function processShopRedact(
  shopDomain: string,
  _payload: ShopRedactPayload
): Promise<ShopRedactResult> {
  logger.info(`[GDPR] Processing shop redact for ${shopDomain} - DELETING ALL DATA`);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  const deletedCounts = createEmptyShopRedactDeletionCounts();
  const sessionResult = await prisma.session.deleteMany({
    where: { shop: shopDomain },
  });
  deletedCounts.sessions = sessionResult.count;
  if (shop) {
    const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.pixelEventReceipts = pixelReceiptResult.count;
    const verificationRunResult = await prisma.verificationRun.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.verificationRuns = verificationRunResult.count;
    const scanReportResult = await prisma.scanReport.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.scanReports = scanReportResult.count;
    const auditAssetResult = await prisma.auditAsset.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.auditAssets = auditAssetResult.count;
    const pixelConfigResult = await prisma.pixelConfig.deleteMany({
      where: { shopId: shop.id },
    });
    deletedCounts.pixelConfigs = pixelConfigResult.count;
    await prisma.shop.delete({
      where: { id: shop.id },
    });
    deletedCounts.shop = 1;
  }
  const result: ShopRedactResult = {
    shopDomain,
    deletedCounts,
  };
  logger.info(`[GDPR] Shop redact completed for ${shopDomain}`, { ...deletedCounts });
  return result;
}
