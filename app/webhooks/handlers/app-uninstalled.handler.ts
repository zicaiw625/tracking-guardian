/**
 * APP_UNINSTALLED Webhook Handler
 *
 * Handles app uninstallation:
 * - Cleans up WebPixel if possible
 * - Marks shop as inactive
 * - Deletes session data
 */

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { WebhookContext, WebhookHandlerResult, ShopWithPixelConfigs } from "../types";

// =============================================================================
// WebPixel Cleanup
// =============================================================================

/**
 * Attempt to cleanup WebPixel before losing access.
 * This may fail if the shop has already revoked access.
 */
async function tryCleanupWebPixel(
  admin: NonNullable<WebhookContext["admin"]>,
  shop: string
): Promise<void> {
  try {
    const { getExistingWebPixels, isOurWebPixel } = await import(
      "../../services/migration.server"
    );
    const { deleteWebPixel } = await import(
      "../../services/admin-mutations.server"
    );

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
          // Ignore parse errors
        }
      }
    }
  } catch (cleanupError) {
    // Log but don't fail - shop may have already revoked access
    logger.warn(`WebPixel cleanup attempt failed for ${shop}`, {
      error:
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
    });
  }
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Handle APP_UNINSTALLED webhook
 */
export async function handleAppUninstalled(
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
): Promise<WebhookHandlerResult> {
  const { shop, admin, session } = context;

  logger.info(`Processing APP_UNINSTALLED for shop ${shop}`);

  // Attempt to cleanup WebPixel before losing access
  if (admin && typeof admin === "object" && "graphql" in admin) {
    await tryCleanupWebPixel(admin as NonNullable<WebhookContext["admin"]>, shop);
  }

  // Delete session data
  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
    logger.info(`Deleted sessions for ${shop}`);
  }

  // Mark shop as inactive
  if (shopRecord) {
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        isActive: false,
        uninstalledAt: new Date(),
      },
    });
    logger.info(`Marked shop ${shop} as inactive`);
  }

  logger.info(`Successfully processed APP_UNINSTALLED for shop ${shop}`);

  return {
    success: true,
    status: 200,
    message: "App uninstalled",
  };
}

