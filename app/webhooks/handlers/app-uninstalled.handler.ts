import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "../types";
import { getExistingWebPixels, isOurWebPixel } from "../../services/migration.server";
import { deleteWebPixel } from "../../services/admin-mutations.server";

async function tryCleanupWebPixel(
  admin: NonNullable<WebhookContext["admin"]>,
  shop: string
): Promise<void> {
  try {
    const typedAdmin = admin as {
      graphql: (
        query: string,
        options?: { variables?: Record<string, unknown> }
      ) => Promise<{ json: () => Promise<unknown> }>;
    };
    const webPixels = await getExistingWebPixels(
      typedAdmin as Parameters<typeof getExistingWebPixels>[0]
    );
    for (const pixel of webPixels) {
      if (pixel.settings) {
        try {
          const settings = JSON.parse(pixel.settings);
          if (isOurWebPixel(settings, shop)) {
            const deleteResult = await deleteWebPixel(
              typedAdmin as Parameters<typeof deleteWebPixel>[0],
              pixel.id
            );
            if (deleteResult.success) {
              logger.info(`Cleaned up WebPixel on uninstall`, {
                shop,
                webPixelId: pixel.id,
              });
            } else {
              logger.warn(`Failed to cleanup WebPixel on uninstall`, {
                shop,
                webPixelId: pixel.id,
                error: deleteResult.error,
              });
            }
          }
        } catch {
          // no-op: ignore per-pixel delete errors, continue with rest
        }
      }
    }
  } catch (cleanupError) {
    if (cleanupError instanceof Response) {
      const status = cleanupError.status;
      const statusText = cleanupError.statusText;
      if (status === 401 || status === 403) {
        logger.info(`WebPixel cleanup skipped (unauthorized/uninstalled) for ${shop}`, { status, statusText });
      } else {
        logger.warn(`WebPixel cleanup attempt failed (HTTP response) for ${shop}`, { status, statusText });
      }
      return;
    }
    logger.warn(`WebPixel cleanup attempt failed for ${shop}`, {
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  }
}

export async function handleAppUninstalled(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
): Promise<WebhookHandlerResult> {
  const { shop, admin, session } = context;
  logger.info(`Processing APP_UNINSTALLED for shop ${shop}`);
  if (admin && typeof admin === "object" && "graphql" in admin) {
    await tryCleanupWebPixel(admin as NonNullable<WebhookContext["admin"]>, shop);
  }
  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
    logger.info(`Deleted sessions for ${shop}`);
  }
  if (shopRecord) {
    const pixelReceiptsDeleted = await prisma.pixelEventReceipt.deleteMany({
      where: { shopId: shopRecord.id },
    });
    logger.info(`Deleted pixel event receipts for shop ${shop}`, {
      pixelReceiptsDeleted: pixelReceiptsDeleted.count,
    });
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        isActive: false,
        uninstalledAt: new Date(),
      },
    });
    logger.info(`Marked shop ${shop} as inactive - will be deleted within 48 hours by cleanup task`);
  }
  logger.info(`Successfully processed APP_UNINSTALLED for shop ${shop}`);
  return {
    success: true,
    status: 200,
    message: "App uninstalled",
  };
}
