

import { randomUUID } from "crypto";
import prisma, { type TransactionClient } from "../db.server";
import {
  checkAndReserveBillingSlot,
  releaseBillingSlot,
  type PlanId,
} from "./billing.server";
import { decryptCredentials } from "./credentials.server";
import { sendConversionToPlatform } from "./platforms/factory";
import { generateEventId } from "../utils/crypto.server";
import { generateCanonicalEventId } from "../services/event-normalizer.server";
import { logger } from "../utils/logger.server";
import { JOB_PROCESSING_CONFIG } from "../utils/config";
import { safeFireAndForget } from "../utils/helpers";
import { JobStatus, parseCapiInput, parsePixelClientConfig } from "../types";
import type { ConversionData, PlatformCredentials } from "../types";
import { parsePlatformResults } from "../types/database";

import {
  batchFetchReceipts,
  findReceiptForJob,
  updateReceiptTrustLevel,
  type ReceiptFields,
} from "./receipt-matcher.server";
import {
  evaluateTrust,
  checkPlatformEligibility,
  buildConsentEvidence,
  didReceiptMatchByToken,
  type ShopTrustContext,
} from "./trust-evaluator.server";

export interface ProcessConversionJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
  skipped: number;
}

interface JobWithRelations {
  id: string;
  shopId: string;
  orderId: string;
  orderNumber: string | null;
  orderValue: number | { toNumber(): number };
  currency: string;
  capiInput: unknown;
  platformResults: unknown;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  shop: {
    id: string;
    shopDomain: string;
    plan: string | null;
    // P0-2: v1.0 版本不包含任何 PCD/PII 处理，因此移除 piiEnabled 字段
    consentStrategy: string | null;
    primaryDomain: string | null;
    storefrontDomains: string[];
    pixelConfigs: Array<{
      id: string;
      platform: string;
      platformId: string | null;
      credentialsEncrypted: string | null;
      credentials: unknown;
      clientConfig: unknown;
    }>;
  };
}

type JobProcessResult = "succeeded" | "failed" | "limit_exceeded" | "skipped";

interface JobUpdateEntry {
  id: string;
  status: string;
  data: Record<string, unknown>;
}

const {
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  BACKOFF_MULTIPLIER,
  BATCH_SIZE: DEFAULT_BATCH_SIZE,
} = JOB_PROCESSING_CONFIG;

interface BatchBackoffState {
  consecutiveHighFailureBatches: number;
  lastBatchFailureRate: number;
  currentDelayMs: number;
}

const BATCH_BACKOFF_CONFIG = {

  FAILURE_RATE_THRESHOLD: 0.5,

  INITIAL_BATCH_DELAY_MS: 1000,

  MAX_BATCH_DELAY_MS: 30000,

  BACKOFF_MULTIPLIER: 2,

  RESET_THRESHOLD: 3,
} as const;

const batchBackoffState: BatchBackoffState = {
  consecutiveHighFailureBatches: 0,
  lastBatchFailureRate: 0,
  currentDelayMs: 0,
};

function updateBatchBackoff(
  succeeded: number,
  failed: number,
  limitExceeded: number
): void {
  const total = succeeded + failed + limitExceeded;
  if (total === 0) return;

  const failureRate = (failed + limitExceeded) / total;
  batchBackoffState.lastBatchFailureRate = failureRate;

  if (failureRate >= BATCH_BACKOFF_CONFIG.FAILURE_RATE_THRESHOLD) {

    batchBackoffState.consecutiveHighFailureBatches++;

    if (batchBackoffState.currentDelayMs === 0) {
      batchBackoffState.currentDelayMs = BATCH_BACKOFF_CONFIG.INITIAL_BATCH_DELAY_MS;
    } else {
      batchBackoffState.currentDelayMs = Math.min(
        batchBackoffState.currentDelayMs * BATCH_BACKOFF_CONFIG.BACKOFF_MULTIPLIER,
        BATCH_BACKOFF_CONFIG.MAX_BATCH_DELAY_MS
      );
    }

    logger.warn(
      `[P2-2] High batch failure rate: ${(failureRate * 100).toFixed(1)}%. ` +
      `Consecutive: ${batchBackoffState.consecutiveHighFailureBatches}. ` +
      `Next batch delay: ${batchBackoffState.currentDelayMs}ms`
    );
  } else {

    if (batchBackoffState.consecutiveHighFailureBatches > 0) {
      batchBackoffState.consecutiveHighFailureBatches--;
    }

    if (batchBackoffState.consecutiveHighFailureBatches === 0) {

      batchBackoffState.currentDelayMs = 0;
    } else {

      batchBackoffState.currentDelayMs = Math.floor(
        batchBackoffState.currentDelayMs / BATCH_BACKOFF_CONFIG.BACKOFF_MULTIPLIER
      );
    }
  }
}

export function getBatchBackoffDelay(): number {
  return batchBackoffState.currentDelayMs;
}

async function applyBatchBackoff(): Promise<void> {
  if (batchBackoffState.currentDelayMs > 0) {
    logger.info(`[P2-2] Applying batch backoff delay: ${batchBackoffState.currentDelayMs}ms`);
    await new Promise(resolve => setTimeout(resolve, batchBackoffState.currentDelayMs));
  }
}

export function calculateNextRetryTime(attempts: number): Date {
  const delayMs = Math.min(
    BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempts - 1),
    MAX_DELAY_MS
  );
  const jitter = delayMs * 0.1 * Math.random();
  return new Date(Date.now() + delayMs + jitter);
}

async function claimJobsForProcessing(batchSize: number): Promise<string[]> {
  const now = new Date();

  const claimedIds = await prisma.$transaction(
    async (tx: TransactionClient) => {
      const availableJobs = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "ConversionJob"
        WHERE (
          status = 'queued'
          OR (
            status = 'failed'
            AND "nextRetryAt" <= ${now}
            AND attempts < "maxAttempts"
          )
        )
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (availableJobs.length === 0) {
        return [];
      }

      const jobIds = availableJobs.map((j: { id: string }) => j.id);
      await tx.conversionJob.updateMany({
        where: { id: { in: jobIds } },
        data: { status: JobStatus.PROCESSING },
      });

      return jobIds;
    },
    { timeout: 10000 }
  );

  return claimedIds;
}

async function fetchJobsWithRelations(
  jobIds: string[]
): Promise<JobWithRelations[]> {
  const jobs = await prisma.conversionJob.findMany({
    where: { id: { in: jobIds } },
    include: {
      Shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          // P0-2: v1.0 版本不包含任何 PCD/PII 处理，因此移除 piiEnabled 字段
          consentStrategy: true,
          primaryDomain: true,
          storefrontDomains: true,
          pixelConfigs: {
            where: { isActive: true, serverSideEnabled: true },
            select: {
              id: true,
              platform: true,
              platformId: true,
              credentialsEncrypted: true,
              clientConfig: true,
            },
          },
        },
      },
    },
  });

  return jobs.map((job) => {
    const { Shop, ...jobWithoutShop } = job;
    return {
      ...jobWithoutShop,
      shop: Shop as JobWithRelations["shop"],
    };
  }) as JobWithRelations[];
}

async function batchUpdateJobs(updates: JobUpdateEntry[]): Promise<void> {
  if (updates.length === 0) return;

  if (updates.length === 1) {
    const { id, status, data } = updates[0];
    await prisma.conversionJob.update({
      where: { id },
      data: { status, ...data },
    });
    return;
  }

  await prisma.$transaction(
    updates.map(({ id, status, data }) =>
      prisma.conversionJob.update({
        where: { id },
        data: { status, ...data },
      })
    )
  );
}

interface PlatformSendResults {
  platformResults: Record<string, string>;
  anyFailed: boolean;
  anySent: boolean;
  allSkipped: boolean;
}

async function sendToPlatformsParallel(
  pixelConfigs: JobWithRelations["shop"]["pixelConfigs"],
  job: JobWithRelations,
  capiInput: ReturnType<typeof parseCapiInput>,
  eventId: string,
  trustResult: ReturnType<typeof evaluateTrust>["trustResult"],
  consentState: ReturnType<typeof evaluateTrust>["consentState"],
  strategy: string,
  previousResults: Record<string, string> = {}
): Promise<PlatformSendResults> {
  const platformResults: Record<string, string> = { ...previousResults };

  const sendTasks = pixelConfigs.map(async (pixelConfig) => {

    if (previousResults[pixelConfig.platform] === "sent") {
      return {
        platform: pixelConfig.platform,
        success: true,
        status: "sent",
        skipped: false,
        sent: true,
      };
    }

    const clientConfig = parsePixelClientConfig(pixelConfig.clientConfig);
    const treatAsMarketing = clientConfig?.treatAsMarketing === true;

    const eligibility = checkPlatformEligibility(
      pixelConfig.platform,
      trustResult,
      consentState,
      strategy,
      treatAsMarketing
    );

    if (!eligibility.allowed) {
      return {
        platform: pixelConfig.platform,
        success: false,
        status: `skipped:${eligibility.skipReason}`,
        skipped: true,
        sent: false,
      };
    }

    const sendResult = await sendToPlatformWithCredentials(
      pixelConfig,
      job,
      capiInput,
      eventId
    );

    return {
      platform: pixelConfig.platform,
      success: sendResult.success,
      status: sendResult.status,
      skipped: false,
      sent: sendResult.success,
    };
  });

  const results = await Promise.allSettled(sendTasks);

  let anyFailed = false;
  let anySent = false;
  let skippedCount = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      platformResults[result.value.platform] = result.value.status;

      if (result.value.sent) {
        anySent = true;
      }
      if (result.value.skipped) {
        skippedCount++;
      }
      if (result.value.status.startsWith("failed:")) {
        anyFailed = true;
      }
    } else {

      logger.error("Platform send task rejected:", result.reason);
      anyFailed = true;
    }
  }

  const allSkipped = skippedCount === pixelConfigs.length && pixelConfigs.length > 0;

  return { platformResults, anyFailed, anySent, allSkipped };
}

async function upsertConversionLogs(
  job: JobWithRelations,
  platformResults: Record<string, string>,
  eventId: string,
  now: Date
): Promise<void> {
  const upsertPromises = Object.entries(platformResults).map(async ([platform, status]) => {

    const isSent = status === "sent";
    const isSkipped = status.startsWith("skipped:");
    const isFailed = status.startsWith("failed:");

    let logStatus: string;
    let errorMessage: string | null = null;

    if (isSent) {
      logStatus = "sent";
    } else if (isSkipped) {
      logStatus = "skipped";
      errorMessage = status;
    } else if (isFailed) {
      logStatus = "failed";
      errorMessage = status.substring(7);
    } else {
      logStatus = "pending";
    }

    const orderValue =
      typeof job.orderValue === "number"
        ? job.orderValue
        : job.orderValue?.toNumber() ?? 0;

    try {
      await prisma.conversionLog.upsert({
        where: {
          shopId_orderId_platform_eventType: {
            shopId: job.shopId,
            orderId: job.orderId,
            platform,
            eventType: "purchase",
          },
        },
        create: {
          id: randomUUID(),
          shopId: job.shopId,
          orderId: job.orderId,
          orderNumber: job.orderNumber,
          orderValue,
          currency: job.currency,
          platform,
          eventType: "purchase",
          eventId,
          status: logStatus,
          attempts: job.attempts + 1,
          lastAttemptAt: now,
          serverSideSent: isSent,
          sentAt: isSent ? now : null,
          clientSideSent: false,
          errorMessage,
        },
        update: {
          orderNumber: job.orderNumber,
          orderValue,
          currency: job.currency,
          eventId,
          status: logStatus,
          attempts: job.attempts + 1,
          lastAttemptAt: now,
          serverSideSent: isSent,
          sentAt: isSent ? now : undefined,
          errorMessage,
        },
      });
    } catch (error) {
      logger.warn(`Failed to upsert ConversionLog for ${platform}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await Promise.all(upsertPromises);
}

async function sendToPlatformWithCredentials(
  pixelConfig: JobWithRelations["shop"]["pixelConfigs"][0],
  job: JobWithRelations,
  capiInput: ReturnType<typeof parseCapiInput>,
  eventId: string
): Promise<{ success: boolean; status: string }> {
  try {
    const credResult = decryptCredentials(pixelConfig, pixelConfig.platform);

    if (!credResult.ok) {
      logger.warn(`Failed to decrypt credentials for ${pixelConfig.platform}: ${credResult.error.message}`);
      return { success: false, status: "failed:no_credentials" };
    }

    const credentials = credResult.value.credentials;

    const lineItems = capiInput?.items?.map((item) => ({
      productId: item.productId || "",
      variantId: item.variantId || "",
      name: item.name || "",
      quantity: item.quantity || 1,
      price: item.price || 0,
    }));

    const orderValue =
      typeof job.orderValue === "number"
        ? job.orderValue
        : job.orderValue?.toNumber() ?? 0;

    // P0-1: v1.0 版本不包含任何 PCD/PII 处理
    // ConversionData 类型中已移除所有 PII 字段（包括 preHashedUserData）
    const conversionData: ConversionData = {
      orderId: job.orderId,
      orderNumber: job.orderNumber,
      value: orderValue,
      currency: job.currency,
      lineItems,
      // P0-1: v1.0 版本 ConversionData 类型中已不包含任何 PII 字段
    };

    const result = await sendConversionToPlatform(
      pixelConfig.platform,
      credentials as PlatformCredentials,
      conversionData,
      eventId
    );

    if (result.success) {
      return { success: true, status: "sent" };
    }

    return {
      success: false,
      status: `failed:${result.error?.message?.substring(0, 50) || "unknown"}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, status: `failed:${errorMsg.substring(0, 50)}` };
  }
}

async function processSingleJob(
  job: JobWithRelations,
  receiptMap: Map<string, ReceiptFields>,
  now: Date
): Promise<{ result: JobProcessResult; update: JobUpdateEntry }> {

  if (job.shop.pixelConfigs.length === 0) {
    logger.debug(`Job ${job.id}: No active platforms configured`);
    return {
      result: "skipped",
      update: {
        id: job.id,
        status: JobStatus.COMPLETED,
        data: {
          processedAt: now,
          completedAt: now,
          platformResults: { message: "No platforms configured" },
        },
      },
    };
  }

  const reservationResult = await checkAndReserveBillingSlot(
    job.shopId,
    (job.shop.plan || "free") as PlanId,
    job.orderId
  );

  if (!reservationResult.ok) {
    logger.error(`Billing reservation failed for job ${job.id}: ${reservationResult.error.message}`);

    return {
      result: "failed",
      update: {
        id: job.id,
        status: JobStatus.FAILED,
        data: {
          attempts: job.attempts + 1,
          lastAttemptAt: now,
          nextRetryAt: calculateNextRetryTime(job.attempts + 1),
          errorMessage: "Billing system error: " + reservationResult.error.message,
        },
      },
    };
  }

  const reservation = reservationResult.value;

  if (!reservation.success) {
    logger.info(`Billing gate blocked job ${job.id}`, {
      reason: "limit_exceeded",
      usage: { current: reservation.current, limit: reservation.limit },
    });
    return {
      result: "limit_exceeded",
      update: {
        id: job.id,
        status: JobStatus.LIMIT_EXCEEDED,
        data: {
          errorMessage: `Monthly limit exceeded: ${reservation.current}/${reservation.limit}`,
          lastAttemptAt: now,
        },
      },
    };
  }

  const capiInputParsed = parseCapiInput(job.capiInput);
  const webhookCheckoutToken = capiInputParsed?.checkoutToken;

  const receipt = await findReceiptForJob(
    receiptMap,
    job.shopId,
    job.orderId,
    webhookCheckoutToken || undefined,
    job.createdAt
  );

  // 优先使用 receipt 中的 eventId（client 端生成的），如果没有则使用与 client 端相同的逻辑生成
  let eventId: string;
  if (receipt?.eventId) {
    eventId = receipt.eventId;
    logger.debug(`Using eventId from receipt for job ${job.id}`, {
      jobId: job.id,
      orderId: job.orderId,
      eventId,
    });
  } else {
    // 使用与 client 端相同的逻辑生成 eventId
    // 注意：client 端发送的 items.id 可能是 variant_id 或 product_id，需要保持一致
    const lineItems = capiInputParsed?.items;
    // 优先使用 variantId（与 client 端 checkout.lineItems 的 id 字段一致），如果没有则使用 productId
    const normalizedItems = lineItems?.map(item => ({
      id: String(item.variantId || item.productId || ""),
      quantity: item.quantity || 1,
    })).filter(item => item.id) || [];
    
    // P1-4: 传递 nonce 参数（webhook job 通常没有 nonce，但函数签名需要）
    // 由于此函数处理的是有 orderId 的 purchase 事件，不会进入 fallback 逻辑
    eventId = generateCanonicalEventId(
      job.orderId,
      webhookCheckoutToken || undefined,
      "purchase",
      job.shop.shopDomain,
      normalizedItems,
      "v2", // 使用新版本
      null // webhook job 通常没有 nonce
    );
    
    logger.debug(`Generated eventId for job ${job.id} using canonical logic`, {
      jobId: job.id,
      orderId: job.orderId,
      eventId,
      itemsCount: normalizedItems.length,
      hasCheckoutToken: !!webhookCheckoutToken,
    });
  }

  const shopContext: ShopTrustContext = {
    shopDomain: job.shop.shopDomain,
    primaryDomain: job.shop.primaryDomain,
    storefrontDomains: job.shop.storefrontDomains,
    consentStrategy: job.shop.consentStrategy || "strict",
  };

  const { trustResult, trustMetadata, consentState } = evaluateTrust(
    receipt,
    webhookCheckoutToken || undefined,
    shopContext
  );

  if (didReceiptMatchByToken(receipt, webhookCheckoutToken || undefined) && receipt) {
    safeFireAndForget(
      updateReceiptTrustLevel(
        job.shopId,
        receipt.orderId,
        trustResult.level,
        trustResult.reason
      ),
      {
        operation: "updateReceiptTrustLevel",
        metadata: {
          shopId: job.shopId,
          orderId: receipt.orderId,
        },
      }
    );
  }

  const strategy = job.shop.consentStrategy || "strict";
  // 使用类型安全的解析函数处理 platformResults
  const previousResults = parsePlatformResults(job.platformResults);

  const { platformResults, anyFailed, anySent, allSkipped } = await sendToPlatformsParallel(
    job.shop.pixelConfigs,
    job,
    capiInputParsed,
    eventId,
    trustResult,
    consentState,
    strategy,
    previousResults
  );

  safeFireAndForget(
    upsertConversionLogs(job, platformResults, eventId, now),
    {
      operation: "upsertConversionLogs",
      metadata: {
        jobId: job.id,
        shopId: job.shopId,
        orderId: job.orderId,
      },
    }
  );

  const consentEvidence = buildConsentEvidence(
    strategy,
    !!receipt,
    trustResult,
    consentState
  );

  const newAttempts = job.attempts + 1;

  if (allSkipped) {

    if (!reservation.alreadyCounted) {
      const releaseResult = await releaseBillingSlot(job.shopId);
      if (!releaseResult.ok) {
        logger.error("Failed to release billing slot", {
          jobId: job.id,
          shopId: job.shopId,
          error: releaseResult.error.message,
          errorType: releaseResult.error.type,
        });
        // 注意：即使释放失败，也不应该阻止作业完成
        // 可以考虑添加重试机制或告警
      }
    }

    logger.info(`Job ${job.id}: All platforms skipped, not billing`);

    return {
      result: "skipped",
      update: {
        id: job.id,
        status: JobStatus.COMPLETED,
        data: {
          attempts: newAttempts,
          lastAttemptAt: now,
          processedAt: now,
          completedAt: now,
          platformResults,
          errorMessage: "All platforms skipped (consent/trust/config)",
          trustMetadata: trustMetadata as object,
          consentEvidence: JSON.parse(JSON.stringify(consentEvidence)),
        },
      },
    };
  }

  if (anySent) {

    if (anyFailed) {
      if (newAttempts >= job.maxAttempts) {
        return {
          result: "succeeded",
          update: {
            id: job.id,
            status: JobStatus.COMPLETED,
            data: {
              attempts: newAttempts,
              lastAttemptAt: now,
              processedAt: now,
              completedAt: now,
              platformResults,
              errorMessage: "Partial success: some platforms failed after max attempts",
              trustMetadata: trustMetadata as object,
              consentEvidence: JSON.parse(JSON.stringify(consentEvidence)),
            },
          },
        };
      }

      return {
        result: "succeeded",
        update: {
          id: job.id,
          status: JobStatus.FAILED,
          data: {
            attempts: newAttempts,
            lastAttemptAt: now,
            nextRetryAt: calculateNextRetryTime(newAttempts),
            platformResults,
            errorMessage: "Partial success: retrying failed platforms",
            trustMetadata: trustMetadata as object,
            consentEvidence: JSON.parse(JSON.stringify(consentEvidence)),
          },
        },
      };
    }

    return {
      result: "succeeded",
      update: {
        id: job.id,
        status: JobStatus.COMPLETED,
        data: {
          attempts: newAttempts,
          lastAttemptAt: now,
          processedAt: now,
          completedAt: now,
          platformResults,
          errorMessage: null,
          trustMetadata: trustMetadata as object,
          consentEvidence: JSON.parse(JSON.stringify(consentEvidence)),
        },
      },
    };
  }

  if (!reservation.alreadyCounted) {
    const releaseResult = await releaseBillingSlot(job.shopId);
    if (!releaseResult.ok) {
      logger.error("Failed to release billing slot", {
        jobId: job.id,
        shopId: job.shopId,
        error: releaseResult.error.message,
        errorType: releaseResult.error.type,
      });
      // 注意：即使释放失败，也不应该阻止作业完成
      // 可以考虑添加重试机制或告警
    }
  }

  if (newAttempts >= job.maxAttempts) {
    return {
      result: "failed",
      update: {
        id: job.id,
        status: JobStatus.DEAD_LETTER,
        data: {
          attempts: newAttempts,
          lastAttemptAt: now,
          platformResults,
          errorMessage: "All platforms failed after max attempts",
        },
      },
    };
  }

  return {
    result: "failed",
    update: {
      id: job.id,
      status: JobStatus.FAILED,
      data: {
        attempts: newAttempts,
        lastAttemptAt: now,
        nextRetryAt: calculateNextRetryTime(newAttempts),
        platformResults,
        errorMessage: "All platforms failed, retrying...",
      },
    },
  };
}

export async function processConversionJobs(
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<ProcessConversionJobsResult> {
  const now = new Date();

  await applyBatchBackoff();

  const claimedJobIds = await claimJobsForProcessing(batchSize);

  if (claimedJobIds.length === 0) {
    logger.debug("processConversionJobs: No jobs to process");
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      limitExceeded: 0,
      skipped: 0,
    };
  }

  logger.info(`processConversionJobs: Claimed ${claimedJobIds.length} jobs`);

  const jobsToProcess = await fetchJobsWithRelations(claimedJobIds);

  const receiptMap = await batchFetchReceipts(
    jobsToProcess.map((j) => ({
      shopId: j.shopId,
      orderId: j.orderId,
      checkoutToken: parseCapiInput(j.capiInput)?.checkoutToken,
      createdAt: j.createdAt,
    }))
  );

  const updates: JobUpdateEntry[] = [];
  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;
  let skipped = 0;

  const CONCURRENCY = 10;
  for (let i = 0; i < jobsToProcess.length; i += CONCURRENCY) {
    const batch = jobsToProcess.slice(i, i + CONCURRENCY);
    
    // 使用Promise.allSettled确保所有任务都完成，即使有失败
    // 这样可以避免一个任务失败影响其他任务
    const results = await Promise.allSettled(
      batch.map(async (job, index) => {
        try {
          // 添加任务标识，便于追踪和去重
          const jobId = job.id;
          const result = await processSingleJob(job, receiptMap, now);
          
          // 验证返回结果的有效性
          if (!result || !result.update || !result.result) {
            logger.error(`Invalid result from processSingleJob for job ${job.id}`, {
              jobId: job.id,
              shopId: job.shopId,
              orderId: job.orderId,
              result: result ? JSON.stringify(result) : "null",
            });
            throw new Error("Invalid result from processSingleJob");
          }
          
          return result;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          const errorStack = error instanceof Error ? error.stack : undefined;
          
          logger.error(`Failed to process job ${job.id}`, error instanceof Error ? error : new Error(String(error)), {
            jobId: job.id,
            shopId: job.shopId,
            orderId: job.orderId,
            errorMessage: errorMsg,
            errorStack,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
          });

          return {
            result: "failed" as JobProcessResult,
            update: {
              id: job.id,
              status: JobStatus.FAILED,
              data: {
                attempts: job.attempts + 1,
                lastAttemptAt: now,
                nextRetryAt: calculateNextRetryTime(job.attempts + 1),
                errorMessage: errorMsg,
              },
            },
          };
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        updates.push(result.value.update);

        switch (result.value.result) {
          case "succeeded":
            succeeded++;
            break;
          case "failed":
            failed++;
            break;
          case "limit_exceeded":
            limitExceeded++;
            break;
          case "skipped":
            skipped++;
            break;
        }
      } else {
        failed++;
        const errorReason = result.reason instanceof Error 
          ? result.reason 
          : new Error(String(result.reason));
        logger.error("Job processing promise rejected", errorReason, {
          errorMessage: errorReason.message,
          errorStack: errorReason.stack,
          errorName: errorReason.name,
        });
      }
    }
  }

  try {
    await batchUpdateJobs(updates);
  } catch (error) {
    logger.error("Failed to batch update jobs:", error);

    for (const update of updates) {
      try {
        await prisma.conversionJob.update({
          where: { id: update.id },
          data: { status: update.status, ...update.data },
        });
      } catch (updateError) {
        logger.error(`Failed to update job ${update.id}:`, updateError);
      }
    }
  }

  updateBatchBackoff(succeeded, failed, limitExceeded);

  logger.info(
    `processConversionJobs: Completed - ` +
      `${succeeded} succeeded, ${failed} failed, ` +
      `${limitExceeded} limit exceeded, ${skipped} skipped` +
      (batchBackoffState.currentDelayMs > 0
        ? ` (backoff: ${batchBackoffState.currentDelayMs}ms)`
        : "")
  );

  return {
    processed: jobsToProcess.length,
    succeeded,
    failed,
    limitExceeded,
    skipped,
  };
}

