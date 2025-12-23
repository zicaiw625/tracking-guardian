/**
 * GDPR Webhook Handlers
 *
 * Handles GDPR-related webhooks:
 * - CUSTOMERS_DATA_REQUEST
 * - CUSTOMERS_REDACT
 * - SHOP_REDACT
 *
 * All GDPR requests are queued for async processing.
 */

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import {
  parseGDPRDataRequestPayload,
  parseGDPRCustomerRedactPayload,
  parseGDPRShopRedactPayload,
} from "../../utils/webhook-validation";
import { GDPRJobStatus } from "../../types/enums";
import type { WebhookContext, WebhookHandlerResult, GDPRJobType } from "../types";

// =============================================================================
// Queue GDPR Job
// =============================================================================

/**
 * Queue a GDPR job for async processing
 */
async function queueGDPRJob(
  shopDomain: string,
  jobType: GDPRJobType,
  payload: unknown
): Promise<void> {
  await prisma.gDPRJob.create({
    data: {
      shopDomain,
      jobType,
      payload: JSON.parse(JSON.stringify(payload)),
      status: GDPRJobStatus.QUEUED,
    },
  });

  logger.info(`GDPR ${jobType} job queued for ${shopDomain}`);
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Handle CUSTOMERS_DATA_REQUEST webhook
 */
export async function handleCustomersDataRequest(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;

  logger.info(`GDPR data request received for shop ${shop}`);

  try {
    const dataRequestPayload = parseGDPRDataRequestPayload(payload, shop);
    if (!dataRequestPayload) {
      logger.warn(`Invalid CUSTOMERS_DATA_REQUEST payload from ${shop}`);
      return {
        success: false,
        status: 400,
        message: "Invalid payload",
      };
    }

    await queueGDPRJob(shop, "data_request", dataRequestPayload);

    return {
      success: true,
      status: 200,
      message: "GDPR data request queued",
    };
  } catch (error) {
    logger.error("Failed to queue GDPR data request:", error);
    return {
      success: false,
      status: 500,
      message: "Failed to queue GDPR job",
    };
  }
}

/**
 * Handle CUSTOMERS_REDACT webhook
 */
export async function handleCustomersRedact(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;

  logger.info(`GDPR customer redact request for shop ${shop}`);

  try {
    const customerRedactPayload = parseGDPRCustomerRedactPayload(payload, shop);
    if (!customerRedactPayload) {
      logger.warn(`Invalid CUSTOMERS_REDACT payload from ${shop}`);
      return {
        success: false,
        status: 400,
        message: "Invalid payload",
      };
    }

    await queueGDPRJob(shop, "customer_redact", customerRedactPayload);

    return {
      success: true,
      status: 200,
      message: "GDPR customer redact queued",
    };
  } catch (error) {
    logger.error("Failed to queue GDPR customer redact:", error);
    return {
      success: false,
      status: 500,
      message: "Failed to queue GDPR job",
    };
  }
}

/**
 * Handle SHOP_REDACT webhook
 */
export async function handleShopRedact(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload } = context;

  logger.info(`GDPR shop redact request for shop ${shop}`);

  try {
    const shopRedactPayload = parseGDPRShopRedactPayload(payload, shop);
    if (!shopRedactPayload) {
      logger.warn(`Invalid SHOP_REDACT payload from ${shop}`);
      return {
        success: false,
        status: 400,
        message: "Invalid payload",
      };
    }

    await queueGDPRJob(shop, "shop_redact", shopRedactPayload);

    return {
      success: true,
      status: 200,
      message: "GDPR shop redact queued",
    };
  } catch (error) {
    logger.error("Failed to queue GDPR shop redact:", error);
    return {
      success: false,
      status: 500,
      message: "Failed to queue GDPR job",
    };
  }
}

