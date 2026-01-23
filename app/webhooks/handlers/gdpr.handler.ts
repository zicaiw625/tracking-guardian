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
import prisma from "../../db.server";
import { GDPRJobStatus } from "../../types/enums";
import { generateSimpleId } from "../../utils/helpers";

function sanitizeTopicForId(topic: string): string {
  return topic.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 50);
}

function buildGdprJobId(webhookId: string | null, topic: string): string {
  if (webhookId && webhookId.trim()) {
    return `gdpr_${webhookId}_${sanitizeTopicForId(topic)}`;
  }
  return generateSimpleId("gdpr");
}

async function upsertGdprJob(options: {
  id: string;
  shopDomain: string;
  jobType: string;
  payload: unknown;
  status: string;
  result?: unknown;
  errorMessage?: string | null;
}): Promise<void> {
  const now = new Date();
  await prisma.gDPRJob.upsert({
    where: { id: options.id },
    create: {
      id: options.id,
      shopDomain: options.shopDomain,
      jobType: options.jobType,
      payload: options.payload ?? {},
      status: options.status,
      result: options.result ?? undefined,
      errorMessage: options.errorMessage ?? null,
      processedAt: now,
      completedAt: options.status === GDPRJobStatus.COMPLETED || options.status === GDPRJobStatus.FAILED ? now : null,
    },
    update: {
      shopDomain: options.shopDomain,
      jobType: options.jobType,
      payload: options.payload ?? {},
      status: options.status,
      result: options.result ?? undefined,
      errorMessage: options.errorMessage ?? null,
      processedAt: now,
      completedAt: options.status === GDPRJobStatus.COMPLETED || options.status === GDPRJobStatus.FAILED ? now : null,
    },
  });
}

export async function handleCustomersDataRequest(
  context: WebhookContext
): Promise<WebhookHandlerResult> {
  const { shop, payload, webhookId } = context;
  const requestId = typeof payload === "object" && payload !== null && "id" in payload
    ? String(payload.id)
    : webhookId;
  const jobId = buildGdprJobId(webhookId, "customers/data_request");
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
      await upsertGdprJob({
        id: jobId,
        shopDomain: shop,
        jobType: "data_request",
        payload: { shop_domain: shop },
        status: GDPRJobStatus.FAILED,
        errorMessage: "Invalid payload",
      });
      return {
        success: false,
        status: 400,
        message: "Invalid payload",
      };
    }
    await upsertGdprJob({
      id: jobId,
      shopDomain: shop,
      jobType: "data_request",
      payload: dataRequestPayload,
      status: GDPRJobStatus.PROCESSING,
    });
    const result = await processDataRequest(shop, dataRequestPayload);
    await upsertGdprJob({
      id: jobId,
      shopDomain: shop,
      jobType: "data_request",
      payload: dataRequestPayload,
      status: GDPRJobStatus.COMPLETED,
      result,
    });
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
    try {
      await upsertGdprJob({
        id: jobId,
        shopDomain: shop,
        jobType: "data_request",
        payload: typeof payload === "object" && payload !== null ? payload : { shop_domain: shop },
        status: GDPRJobStatus.FAILED,
        errorMessage,
      });
    } catch {
      // ignore
    }
    return {
      success: false,
      status: 500,
      message: "GDPR data request processing failed",
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
  const jobId = buildGdprJobId(webhookId, "customers/redact");
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
      await upsertGdprJob({
        id: jobId,
        shopDomain: shop,
        jobType: "customer_redact",
        payload: { shop_domain: shop },
        status: GDPRJobStatus.FAILED,
        errorMessage: "Invalid payload",
      });
      return {
        success: false,
        status: 400,
        message: "Invalid payload",
      };
    }
    await upsertGdprJob({
      id: jobId,
      shopDomain: shop,
      jobType: "customer_redact",
      payload: customerRedactPayload,
      status: GDPRJobStatus.PROCESSING,
    });
    const result = await processCustomerRedact(shop, customerRedactPayload);
    await upsertGdprJob({
      id: jobId,
      shopDomain: shop,
      jobType: "customer_redact",
      payload: customerRedactPayload,
      status: GDPRJobStatus.COMPLETED,
      result,
    });
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
    try {
      await upsertGdprJob({
        id: jobId,
        shopDomain: shop,
        jobType: "customer_redact",
        payload: typeof payload === "object" && payload !== null ? payload : { shop_domain: shop },
        status: GDPRJobStatus.FAILED,
        errorMessage,
      });
    } catch {
      // ignore
    }
    return {
      success: false,
      status: 500,
      message: "GDPR customer redact processing failed",
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
  const jobId = buildGdprJobId(webhookId, "shop/redact");
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
      await upsertGdprJob({
        id: jobId,
        shopDomain: shop,
        jobType: "shop_redact",
        payload: { shop_domain: shop },
        status: GDPRJobStatus.FAILED,
        errorMessage: "Invalid payload",
      });
      return {
        success: false,
        status: 400,
        message: "Invalid payload",
      };
    }
    await upsertGdprJob({
      id: jobId,
      shopDomain: shop,
      jobType: "shop_redact",
      payload: shopRedactPayload,
      status: GDPRJobStatus.PROCESSING,
    });
    const result = await processShopRedact(shop, shopRedactPayload);
    await upsertGdprJob({
      id: jobId,
      shopDomain: shop,
      jobType: "shop_redact",
      payload: shopRedactPayload,
      status: GDPRJobStatus.COMPLETED,
      result,
    });
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
    try {
      await upsertGdprJob({
        id: jobId,
        shopDomain: shop,
        jobType: "shop_redact",
        payload: typeof payload === "object" && payload !== null ? payload : { shop_domain: shop },
        status: GDPRJobStatus.FAILED,
        errorMessage,
      });
    } catch {
      // ignore
    }
    return {
      success: false,
      status: 500,
      message: "GDPR shop redact processing failed",
    };
  }
}
