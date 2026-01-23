import { logger } from "../../utils/logger.server";
import { syncSubscriptionStatus } from "../../services/billing/subscription.server";
import type { WebhookContext, WebhookHandlerResult } from "../types";

export async function handleAppSubscriptionsUpdate(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, admin } = context;
  
  if (!admin) {
    logger.warn(`No admin context for app_subscriptions/update webhook from ${shop}`);
    return {
      success: true,
      message: "OK (no admin context)",
      status: 200,
    };
  }

  try {
    await syncSubscriptionStatus(admin, shop);
    logger.info(`Subscription status synced for ${shop} via webhook`);
    return {
      success: true,
      message: "OK",
      status: 200,
    };
  } catch (error) {
    logger.error(`Failed to sync subscription status for ${shop}:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      status: 500,
    };
  }
}
