import { logger } from "../../utils/logger.server";
import {
  parseGDPRDataRequestPayload,
  parseGDPRCustomerRedactPayload,
  parseGDPRShopRedactPayload,
} from "../../utils/webhook-validation";
import type { WebhookContext, WebhookHandlerResult } from "../types";
import { processDataRequest } from "../../services/gdpr/handlers/data-request";
import { processCustomerRedact } from "../../services/gdpr/handlers/customer-redact";
import { processShopRedact } from "../../services/gdpr/handlers/shop-redact";

export async function handleCustomersDataRequest(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload, webhookId } = context;
  const requestId = typeof payload === "object" && payload !== null && "id" in payload
    ? String(payload.id)
    : webhookId;
  logger.info(`GDPR data request received for shop ${shop}`, {
    requestId,
    webhookId,
    topic: "customers/data_request",
  });
  try {
    const dataRequestPayload = parseGDPRDataRequestPayload(payload, shop);
    if (!dataRequestPayload) {
      logger.warn(`Invalid CUSTOMERS_DATA_REQUEST payload from ${shop}`, {
        requestId,
        webhookId,
      });
      return {
        success: false,
        status: 400,
        message: "Invalid payload",
      };
    }
    await processDataRequest(shop, dataRequestPayload);
    return {
      success: true,
      status: 200,
      message: "GDPR data request processed",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to process GDPR data request", {
      shop,
      requestId,
      webhookId,
      error: errorMessage,
    });
    return {
      success: true,
      status: 200,
      message: "GDPR data request acknowledged",
    };
  }
}

export async function handleCustomersRedact(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload, webhookId } = context;
  const requestId = typeof payload === "object" && payload !== null && "id" in payload
    ? String(payload.id)
    : webhookId;
  logger.info(`GDPR customer redact request for shop ${shop}`, {
    requestId,
    webhookId,
    topic: "customers/redact",
  });
  try {
    const customerRedactPayload = parseGDPRCustomerRedactPayload(payload, shop);
    if (!customerRedactPayload) {
      logger.warn(`Invalid CUSTOMERS_REDACT payload from ${shop}`, {
        requestId,
        webhookId,
      });
      return {
        success: false,
        status: 400,
        message: "Invalid payload",
      };
    }
    await processCustomerRedact(shop, customerRedactPayload);
    return {
      success: true,
      status: 200,
      message: "GDPR customer redact processed",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to process GDPR customer redact", {
      shop,
      requestId,
      webhookId,
      error: errorMessage,
    });
    return {
      success: true,
      status: 200,
      message: "GDPR customer redact acknowledged",
    };
  }
}

export async function handleShopRedact(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload, webhookId } = context;
  const requestId = typeof payload === "object" && payload !== null && "id" in payload
    ? String(payload.id)
    : webhookId;
  logger.info(`GDPR shop redact request for shop ${shop}`, {
    requestId,
    webhookId,
    topic: "shop/redact",
  });
  try {
    const shopRedactPayload = parseGDPRShopRedactPayload(payload, shop);
    if (!shopRedactPayload) {
      logger.warn(`Invalid SHOP_REDACT payload from ${shop}`, {
        requestId,
        webhookId,
      });
      return {
        success: false,
        status: 400,
        message: "Invalid payload",
      };
    }
    await processShopRedact(shop, shopRedactPayload);
    return {
      success: true,
      status: 200,
      message: "GDPR shop redact processed",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to process GDPR shop redact", {
      shop,
      requestId,
      webhookId,
      error: errorMessage,
    });
    return {
      success: true,
      status: 200,
      message: "GDPR shop redact acknowledged",
    };
  }
}
