import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import {
  parseGDPRDataRequestPayload,
  parseGDPRCustomerRedactPayload,
  parseGDPRShopRedactPayload,
} from "../../utils/webhook-validation";
import { GDPRJobStatus } from "../../types/enums";
import type { WebhookContext, WebhookHandlerResult, GDPRJobType } from "../types";

function sanitizePayloadForLogging(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  const piiFields = new Set([
    "email",
    "phone",
    "first_name",
    "last_name",
    "address1",
    "address2",
    "city",
    "province",
    "zip",
    "country",
    "customer",
    "orders_requested",
  ]);

  for (const [key, value] of Object.entries(payload)) {
    if (piiFields.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizePayloadForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

async function isGDPRJobAlreadyProcessed(
  shopDomain: string,
  jobType: GDPRJobType,
  requestId: string | null
): Promise<boolean> {
  if (!requestId) {
    return false;
  }

  const existing = await prisma.gDPRJob.findFirst({
    where: {
      shopDomain,
      jobType,
      payload: {
        path: ["request_id"],
        equals: requestId,
      },
    },
    select: { id: true, status: true },
  });

  return !!existing && existing.status !== GDPRJobStatus.QUEUED;
}

async function queueGDPRJob(
  shopDomain: string,
  jobType: GDPRJobType,
  payload: unknown,
  requestId: string | null
): Promise<{ queued: boolean; reason?: string }> {

  const alreadyProcessed = await isGDPRJobAlreadyProcessed(shopDomain, jobType, requestId);
  if (alreadyProcessed) {
    logger.info(`GDPR ${jobType} job already processed for ${shopDomain} (request_id: ${requestId})`);
    return { queued: false, reason: "already_processed" };
  }

  try {
    await prisma.gDPRJob.create({
      data: {
        id: randomUUID(),
        shopDomain,
        jobType,
        payload: JSON.parse(JSON.stringify(payload)),
        status: GDPRJobStatus.QUEUED,
      },
    });

    const sanitizedPayload = sanitizePayloadForLogging(payload);
    logger.info(`GDPR ${jobType} job queued for ${shopDomain}`, {
      requestId,
      payload: sanitizedPayload,
    });

    return { queued: true };
  } catch (error) {

    if (error instanceof Error && error.message.includes("Unique constraint")) {
      logger.info(`GDPR ${jobType} job already exists for ${shopDomain} (request_id: ${requestId})`);
      return { queued: false, reason: "already_exists" };
    }
    throw error;
  }
}

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

    const queueResult = await queueGDPRJob(
      shop,
      "data_request",
      dataRequestPayload,
      requestId
    );

    if (!queueResult.queued && queueResult.reason === "already_processed") {
      return {
        success: true,
        status: 200,
        message: "GDPR data request already processed",
      };
    }

    return {
      success: true,
      status: 200,
      message: "GDPR data request queued",
    };
  } catch (error) {

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to queue GDPR data request", {
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

    const queueResult = await queueGDPRJob(
      shop,
      "customer_redact",
      customerRedactPayload,
      requestId
    );

    if (!queueResult.queued && queueResult.reason === "already_processed") {
      return {
        success: true,
        status: 200,
        message: "GDPR customer redact already processed",
      };
    }

    return {
      success: true,
      status: 200,
      message: "GDPR customer redact queued",
    };
  } catch (error) {

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to queue GDPR customer redact", {
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

    const queueResult = await queueGDPRJob(
      shop,
      "shop_redact",
      shopRedactPayload,
      requestId
    );

    if (!queueResult.queued && queueResult.reason === "already_processed") {
      return {
        success: true,
        status: 200,
        message: "GDPR shop redact already processed",
      };
    }

    return {
      success: true,
      status: 200,
      message: "GDPR shop redact queued",
    };
  } catch (error) {

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to queue GDPR shop redact", {
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
