

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

/**
 * P0-2: 日志脱敏 - 移除 PII 字段，只记录必要的元数据
 */
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

/**
 * P0-2: 幂等性检查 - 检查是否已处理过相同的 GDPR 请求
 */
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
  // P0-2: 幂等性检查
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

    // P0-2: 日志脱敏 - 不记录 PII
    const sanitizedPayload = sanitizePayloadForLogging(payload);
    logger.info(`GDPR ${jobType} job queued for ${shopDomain}`, {
      requestId,
      payload: sanitizedPayload,
    });

    return { queued: true };
  } catch (error) {
    // P0-2: 幂等性 - 如果是因为唯一约束冲突（重复请求），视为已处理
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

  // P0-2: 记录 request_id 和 topic，但不记录 PII
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
      // P0-2: 无效 payload 返回 400（不是 200），但记录日志
      // 注意：dispatcher 会确保 GDPR webhooks 即使返回 400 也会被转换为 200，避免重试风暴
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

    // P0-2: 对于不存在的 shop，仍然返回 200（幂等性）
    // 由于我们默认不存储 PII，大多数情况下可能没有数据可返回

    const queueResult = await queueGDPRJob(
      shop,
      "data_request",
      dataRequestPayload,
      requestId
    );

    // P0-2: 即使已处理过，也返回 200（幂等性）
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
    // P0-2: 错误处理 - 记录错误但不抛错，返回 200 避免重试风暴
    // 对于 GDPR webhooks，即使处理失败也要返回 200，避免 Shopify 重试
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to queue GDPR data request", {
      shop,
      requestId,
      webhookId,
      error: errorMessage,
      // 不记录 stack trace 中的敏感信息
    });

    // P0-2: 返回 200 而不是 500，避免 webhook 重试风暴
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

  // P0-2: 记录 request_id 和 topic，但不记录 PII
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
      // P0-2: 无效 payload 返回 400（不是 200），但记录日志
      // 注意：dispatcher 会确保 GDPR webhooks 即使返回 400 也会被转换为 200，避免重试风暴
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

    // P0-2: 对于不存在的 shop，仍然返回 200（幂等性）

    const queueResult = await queueGDPRJob(
      shop,
      "customer_redact",
      customerRedactPayload,
      requestId
    );

    // P0-2: 即使已处理过，也返回 200（幂等性）
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
    // P0-2: 错误处理 - 记录错误但不抛错，返回 200 避免重试风暴
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to queue GDPR customer redact", {
      shop,
      requestId,
      webhookId,
      error: errorMessage,
    });

    // P0-2: 返回 200 而不是 500，避免 webhook 重试风暴
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

  // P0-2: 记录 request_id 和 topic，但不记录 PII
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
      // P0-2: 无效 payload 返回 400（不是 200），但记录日志
      // 注意：dispatcher 会确保 GDPR webhooks 即使返回 400 也会被转换为 200，避免重试风暴
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

    // P0-2: 对于不存在的 shop，仍然返回 200（幂等性）

    const queueResult = await queueGDPRJob(
      shop,
      "shop_redact",
      shopRedactPayload,
      requestId
    );

    // P0-2: 即使已处理过，也返回 200（幂等性）
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
    // P0-2: 错误处理 - 记录错误但不抛错，返回 200 避免重试风暴
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to queue GDPR shop redact", {
      shop,
      requestId,
      webhookId,
      error: errorMessage,
    });

    // P0-2: 返回 200 而不是 500，避免 webhook 重试风暴
    return {
      success: true,
      status: 200,
      message: "GDPR shop redact acknowledged",
    };
  }
}

