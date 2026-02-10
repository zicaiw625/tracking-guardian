import { logger } from "../../utils/logger.server";
import {
  parseGDPRDataRequestPayload,
  parseGDPRCustomerRedactPayload,
  parseGDPRShopRedactPayload,
} from "../../utils/webhook-validation";
import type { WebhookContext, WebhookHandlerResult } from "../types";
import prisma from "../../db.server";
import { GDPRJobStatus } from "../../types/enums";
import { generateSimpleId } from "../../utils/helpers";
import type { GDPRJobResult } from "../../services/gdpr/types";

function sanitizeTopicForId(topic: string): string {
  return topic.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 50);
}

function buildGdprJobId(webhookId: string | null, topic: string): string {
  if (webhookId && webhookId.trim()) {
    return `gdpr_${webhookId}_${sanitizeTopicForId(topic)}`;
  }
  return generateSimpleId("gdpr");
}

function buildJobMeta(options: {
  topic: string;
  shop: string;
  webhookId: string | null;
  requestId: string | null;
  jobType: string;
  parsedPayload?: unknown;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    topic: options.topic,
    shopDomain: options.shop,
    webhookId: options.webhookId,
    requestId: options.requestId,
    jobType: options.jobType,
  };
  if (options.parsedPayload && typeof options.parsedPayload === "object") {
    const p = options.parsedPayload as Record<string, unknown>;
    if (options.jobType === "data_request") {
      const orders = p.orders_requested;
      if (Array.isArray(orders)) {
        base.ordersRequestedCount = orders.length;
      }
    }
    if (options.jobType === "customer_redact") {
      const orders = p.orders_to_redact;
      if (Array.isArray(orders)) {
        base.ordersToRedactCount = orders.length;
      }
    }
  }
  return base;
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
        payload: buildJobMeta({
          topic: "customers/data_request",
          shop,
          webhookId,
          requestId,
          jobType: "data_request",
        }),
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
      payload: buildJobMeta({
        topic: "customers/data_request",
        shop,
        webhookId,
        requestId,
        jobType: "data_request",
        parsedPayload: dataRequestPayload,
      }),
      status: GDPRJobStatus.QUEUED,
    });
    return {
      success: true,
      status: 200,
      message: "GDPR data request queued for processing",
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
        payload: buildJobMeta({
          topic: "customers/data_request",
          shop,
          webhookId,
          requestId,
          jobType: "data_request",
        }),
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
        payload: buildJobMeta({
          topic: "customers/redact",
          shop,
          webhookId,
          requestId,
          jobType: "customer_redact",
        }),
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
      payload: buildJobMeta({
        topic: "customers/redact",
        shop,
        webhookId,
        requestId,
        jobType: "customer_redact",
        parsedPayload: customerRedactPayload,
      }),
      status: GDPRJobStatus.QUEUED,
    });
    return {
      success: true,
      status: 200,
      message: "GDPR customer redact queued for processing",
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
        payload: buildJobMeta({
          topic: "customers/redact",
          shop,
          webhookId,
          requestId,
          jobType: "customer_redact",
        }),
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
        payload: buildJobMeta({
          topic: "shop/redact",
          shop,
          webhookId,
          requestId,
          jobType: "shop_redact",
        }),
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
      payload: buildJobMeta({
        topic: "shop/redact",
        shop,
        webhookId,
        requestId,
        jobType: "shop_redact",
        parsedPayload: shopRedactPayload,
      }),
      status: GDPRJobStatus.QUEUED,
    });
    return {
      success: true,
      status: 200,
      message: "GDPR shop redact queued for processing",
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
        payload: buildJobMeta({
          topic: "shop/redact",
          shop,
          webhookId,
          requestId,
          jobType: "shop_redact",
        }),
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
