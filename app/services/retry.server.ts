

import prisma from "../db.server";
import { 
  type PlatformError,
  calculateBackoff,
  shouldRetry as shouldRetryPlatform,
  formatErrorForLog,
} from "./platforms/base.server";
import { 
  checkBillingGate, 
  incrementMonthlyUsage, 
  type PlanId 
} from "./billing.server";
import { generateEventId, normalizeOrderId, generateMatchKey, matchKeysEqual } from "../utils/crypto";
import { extractPIISafely, logPIIStatus } from "../utils/pii";
import type { OrderWebhookPayload } from "../types";

import { logger } from "../utils/logger";
import { 
  evaluatePlatformConsentWithStrategy,
  getEffectiveConsentCategory,
  type ConsentState,
} from "../utils/platform-consent";
import {
  verifyReceiptTrust,
  isSendAllowedByTrust,
  buildTrustMetadata,
  type ReceiptTrustResult,
} from "../utils/receipt-trust";

export type FailureReason = 
  | "token_expired"     
  | "rate_limited"      
  | "platform_error"    
  | "validation_error"  
  | "network_error"     
  | "config_error"      
  | "unknown";          

export function platformErrorToFailureReason(error: PlatformError): FailureReason {
  switch (error.type) {
    case "auth_error":
      return "token_expired";
    case "rate_limited":
      return "rate_limited";
    case "server_error":
      return "platform_error";
    case "validation_error":
      return "validation_error";
    case "timeout":
    case "network_error":
      return "network_error";
    case "invalid_config":
      return "config_error";
    case "quota_exceeded":
      return "config_error"; 
    default:
      return "unknown";
  }
}

export function shouldRetryFromPlatformError(
  error: PlatformError, 
  currentAttempt: number, 
  maxAttempts: number
): boolean {
  return shouldRetryPlatform(error, currentAttempt, maxAttempts);
}

export function getRetryDelay(error: PlatformError, attempt: number): number {
  
  if (error.retryAfter) {
    return error.retryAfter * 1000; 
  }

  return calculateBackoff(attempt);
}

export function classifyFailureReason(errorMessage: string | null): FailureReason {
  if (!errorMessage) return "unknown";
  
  const lowerError = errorMessage.toLowerCase();

  if (
    lowerError.includes("401") ||
    lowerError.includes("unauthorized") ||
    lowerError.includes("token expired") ||
    lowerError.includes("invalid token") ||
    lowerError.includes("access token")
  ) {
    return "token_expired";
  }

  if (
    lowerError.includes("429") ||
    lowerError.includes("rate limit") ||
    lowerError.includes("too many requests")
  ) {
    return "rate_limited";
  }

  if (
    lowerError.includes("500") ||
    lowerError.includes("502") ||
    lowerError.includes("503") ||
    lowerError.includes("504") ||
    lowerError.includes("internal server error") ||
    lowerError.includes("service unavailable")
  ) {
    return "platform_error";
  }

  if (
    lowerError.includes("timeout") ||
    lowerError.includes("network") ||
    lowerError.includes("econnrefused") ||
    lowerError.includes("enotfound") ||
    lowerError.includes("fetch failed")
  ) {
    return "network_error";
  }

  if (
    lowerError.includes("400") ||
    lowerError.includes("invalid") ||
    lowerError.includes("validation") ||
    lowerError.includes("missing required")
  ) {
    return "validation_error";
  }

  if (
    lowerError.includes("credential") ||
    lowerError.includes("decrypt") ||
    lowerError.includes("not configured") ||
    lowerError.includes("api secret")
  ) {
    return "config_error";
  }
  
  return "unknown";
}

export function shouldNotifyImmediately(reason: FailureReason): boolean {
  
  return reason === "token_expired" || reason === "config_error";
}
import { sendConversionToGoogle } from "./platforms/google.server";
import { sendConversionToMeta } from "./platforms/meta.server";
import { sendConversionToTikTok } from "./platforms/tiktok.server";
import { decryptJson } from "../utils/crypto";
import type {
  ConversionData,
  GoogleCredentials,
  MetaCredentials,
  TikTokCredentials,
  PlatformCredentials,
} from "../types";

interface DecryptCredentialsResult {
  credentials: PlatformCredentials | null;
  usedLegacy: boolean;
}

export function getDecryptedCredentials(
  pixelConfig: { credentialsEncrypted?: string | null } & Record<string, unknown>,
  platform: string
): DecryptCredentialsResult {
  let credentials: PlatformCredentials | null = null;
  let usedLegacy = false;
  
  if (pixelConfig.credentialsEncrypted) {
    try {
      credentials = decryptJson<PlatformCredentials>(pixelConfig.credentialsEncrypted);
      return { credentials, usedLegacy: false };
    } catch (decryptError) {
      const errorMsg = decryptError instanceof Error ? decryptError.message : "Unknown error";
      logger.warn(`Failed to decrypt credentialsEncrypted for ${platform}: ${errorMsg}`);
    }
  }
  
  if (!credentials && pixelConfig.credentials) {
    try {
      const legacyCredentials = pixelConfig.credentials;
      
      if (typeof legacyCredentials === "string") {
        credentials = decryptJson<PlatformCredentials>(legacyCredentials);
        usedLegacy = true;
      } else if (typeof legacyCredentials === "object" && legacyCredentials !== null) {
        credentials = legacyCredentials as PlatformCredentials;
        usedLegacy = true;
      }
      
      if (usedLegacy) {
        logger.info(`Using legacy credentials field for ${platform} - please migrate to credentialsEncrypted`);
      }
    } catch (legacyError) {
      const errorMsg = legacyError instanceof Error ? legacyError.message : "Unknown error";
      logger.warn(`Failed to read legacy credentials for ${platform}: ${errorMsg}`);
    }
  }
  
  return { credentials, usedLegacy };
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 60 * 1000; 
const MAX_DELAY_MS = 2 * 60 * 60 * 1000; 

export function calculateNextRetryTime(attempts: number): Date {
  const delayMs = Math.min(
    BASE_DELAY_MS * Math.pow(5, attempts - 1),
    MAX_DELAY_MS
  );

  const jitter = delayMs * 0.1 * Math.random();
  
  return new Date(Date.now() + delayMs + jitter);
}

export async function scheduleRetry(
  logId: string,
  errorMessage: string
): Promise<{ scheduled: boolean; failureReason: FailureReason }> {
  const log = await prisma.conversionLog.findUnique({
    where: { id: logId },
  });

  if (!log) return { scheduled: false, failureReason: "unknown" };

  const failureReason = classifyFailureReason(errorMessage);
  
  const currentAttempts = log.attempts;
  const maxAttempts = log.maxAttempts || MAX_ATTEMPTS;

  if (failureReason === "token_expired" || failureReason === "config_error") {
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "dead_letter",
        lastAttemptAt: new Date(),
        errorMessage: `[${failureReason}] ${errorMessage}`,
        deadLetteredAt: new Date(),
      },
    });
    logger.warn(`Conversion ${logId} moved to dead letter: ${failureReason}`);
    return { scheduled: false, failureReason };
  }

  if (currentAttempts >= maxAttempts) {
    
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "dead_letter",
        lastAttemptAt: new Date(),
        errorMessage: `[${failureReason}] ${errorMessage}`,
        deadLetteredAt: new Date(),
      },
    });
    logger.warn(`Conversion ${logId} moved to dead letter after ${currentAttempts} attempts`);
    return { scheduled: false, failureReason };
  } else {
    
    const nextRetryAt = calculateNextRetryTime(currentAttempts);
    await prisma.conversionLog.update({
      where: { id: logId },
      data: {
        status: "retrying",
        lastAttemptAt: new Date(),
        nextRetryAt,
        errorMessage: `[${failureReason}] ${errorMessage}`,
      },
    });
    logger.info(`Conversion ${logId} scheduled for retry at ${nextRetryAt.toISOString()} (attempt ${currentAttempts}, reason: ${failureReason})`);
    return { scheduled: true, failureReason };
  }
}

export async function processPendingConversions(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}> {
  
  const pendingLogs = await prisma.conversionLog.findMany({
    where: {
      status: "pending",
      attempts: 0, 
    },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          piiEnabled: true,
          pixelConfigs: {
            where: { isActive: true, serverSideEnabled: true },
            select: {
              id: true,
              platform: true,
              platformId: true,
              credentialsEncrypted: true,
              credentials: true,
            },
          },
        },
      },
    },
    take: 100, 
    orderBy: { createdAt: "asc" }, 
  });

  logger.info(`Processing ${pendingLogs.length} pending conversions`);

  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;

  for (const log of pendingLogs) {
    try {
      
      const billingCheck = await checkBillingGate(
        log.shopId,
        (log.shop.plan || "free") as PlanId
      );

      if (!billingCheck.allowed) {
        logger.info(
          `Billing gate blocked conversion ${log.id}: ${billingCheck.reason}, ` +
          `usage=${billingCheck.usage.current}/${billingCheck.usage.limit}`
        );

        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "failed",
            errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
            lastAttemptAt: new Date(),
          },
        });

        limitExceeded++;
        continue;
      }

      const pixelConfig = log.shop.pixelConfigs.find(
        (pc) => pc.platform === log.platform
      );

      if (!pixelConfig) {
        
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "failed",
            attempts: 1,
            lastAttemptAt: new Date(),
            errorMessage: "Pixel config not found or disabled",
          },
        });
        failed++;
        continue;
      }

      const { credentials } = getDecryptedCredentials(
        pixelConfig as { credentialsEncrypted?: string | null } & Record<string, unknown>,
        log.platform
      );

      if (!credentials) {
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "failed",
            attempts: 1,
            lastAttemptAt: new Date(),
            errorMessage: "No credentials configured",
          },
        });
        failed++;
        continue;
      }

      const eventId = log.eventId || generateEventId(log.orderId, log.eventType, log.shop.shopDomain);

      const conversionData: ConversionData = {
        orderId: log.orderId,
        orderNumber: log.orderNumber,
        value: Number(log.orderValue),
        currency: log.currency,
      };

      let result;
      switch (log.platform) {
        case "google":
          result = await sendConversionToGoogle(
            credentials as GoogleCredentials,
            conversionData,
            eventId
          );
          break;
        case "meta":
          result = await sendConversionToMeta(
            credentials as MetaCredentials,
            conversionData,
            eventId
          );
          break;
        case "tiktok":
          result = await sendConversionToTikTok(
            credentials as TikTokCredentials,
            conversionData,
            eventId
          );
          break;
        default:
          throw new Error(`Unsupported platform: ${log.platform}`);
      }

      await prisma.conversionLog.update({
        where: { id: log.id },
        data: {
          status: "sent",
          serverSideSent: true,
          sentAt: new Date(),
          platformResponse: result as object,
          errorMessage: null,
          attempts: 1,
          lastAttemptAt: new Date(),
        },
      });

      await incrementMonthlyUsage(log.shopId, log.orderId);

      succeeded++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await prisma.conversionLog.update({
        where: { id: log.id },
        data: { attempts: 1, lastAttemptAt: new Date() },
      });
      
      await scheduleRetry(log.id, errorMessage);
      failed++;
    }
  }

  return { processed: pendingLogs.length, succeeded, failed, limitExceeded };
}

export async function processRetries(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
}> {
  const now = new Date();

  const logsToRetry = await prisma.conversionLog.findMany({
    where: {
      status: "retrying",
      nextRetryAt: { lte: now },
    },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          pixelConfigs: {
            where: { isActive: true, serverSideEnabled: true },
          },
        },
      },
    },
    take: 50, 
  });

  logger.info(`Processing ${logsToRetry.length} pending retries`);

  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;

  for (const log of logsToRetry) {
    try {
      
      const billingCheck = await checkBillingGate(
        log.shopId,
        (log.shop.plan || "free") as PlanId
      );

      if (!billingCheck.allowed) {
        logger.info(
          `Billing gate blocked retry for ${log.id}: ${billingCheck.reason}, ` +
          `usage=${billingCheck.usage.current}/${billingCheck.usage.limit}`
        );

        await prisma.conversionLog.update({
          where: { id: log.id },
          data: {
            status: "limit_exceeded",
            errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
            lastAttemptAt: now,
          },
        });

        limitExceeded++;
        continue;
      }

      const pixelConfig = log.shop.pixelConfigs.find(
        (pc) => pc.platform === log.platform
      );

      if (!pixelConfig) {
        await scheduleRetry(log.id, "Pixel config not found or disabled");
        failed++;
        continue;
      }

      const { credentials } = getDecryptedCredentials(
        pixelConfig as { credentialsEncrypted?: string | null } & Record<string, unknown>,
        log.platform
      );
      
      if (!credentials) {
        await prisma.conversionLog.update({
          where: { id: log.id },
          data: { attempts: { increment: 1 } },
        });
        await scheduleRetry(log.id, "No credentials configured - please set up in Settings");
        failed++;
        continue;
      }

      const eventId = log.eventId || generateEventId(log.orderId, log.eventType, log.shop.shopDomain);

      const conversionData: ConversionData = {
        orderId: log.orderId,
        orderNumber: log.orderNumber,
        value: Number(log.orderValue),
        currency: log.currency,

      };

      let result;
      switch (log.platform) {
        case "google":
          result = await sendConversionToGoogle(
            credentials as GoogleCredentials,
            conversionData,
            eventId
          );
          break;
        case "meta":
          result = await sendConversionToMeta(
            credentials as MetaCredentials,
            conversionData,
            eventId
          );
          break;
        case "tiktok":
          result = await sendConversionToTikTok(
            credentials as TikTokCredentials,
            conversionData,
            eventId
          );
          break;
        default:
          throw new Error(`Unsupported platform: ${log.platform}`);
      }

      await prisma.conversionLog.update({
        where: { id: log.id },
        data: {
          status: "sent",
          serverSideSent: true,
          sentAt: new Date(),
          platformResponse: result as object,
          errorMessage: null,
          nextRetryAt: null,
          attempts: { increment: 1 }, 
        },
      });

      await incrementMonthlyUsage(log.shopId, log.orderId);

      succeeded++;
      logger.info(`Retry succeeded for ${log.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await prisma.conversionLog.update({
        where: { id: log.id },
        data: { attempts: { increment: 1 } },
      });
      
      await scheduleRetry(log.id, errorMessage);
      failed++;
      logger.error(`Retry failed for ${log.id}: ${errorMessage}`);
    }
  }

  return { processed: logsToRetry.length, succeeded, failed, limitExceeded };
}

async function claimJobsForProcessing(batchSize: number): Promise<string[]> {
  const now = new Date();
  
  const claimedIds = await prisma.$transaction(async (tx) => {
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
    
    const jobIds = availableJobs.map(j => j.id);
    
    await tx.conversionJob.updateMany({
      where: { id: { in: jobIds } },
      data: { status: "processing" },
    });
    
    return jobIds;
  }, {
    timeout: 10000,
  });
  
  return claimedIds;
}

export async function processConversionJobs(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  limitExceeded: number;
  skipped: number;
}> {
  const now = new Date();
  const batchSize = 50;

  const claimedJobIds = await claimJobsForProcessing(batchSize);
  
  if (claimedJobIds.length === 0) {
    logger.debug("processConversionJobs: No jobs to process");
    return { processed: 0, succeeded: 0, failed: 0, limitExceeded: 0, skipped: 0 };
  }
  
  logger.info(`processConversionJobs: Claimed ${claimedJobIds.length} jobs for processing`);

  const jobsToProcess = await prisma.conversionJob.findMany({
    where: {
      id: { in: claimedJobIds },
    },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          piiEnabled: true,
          consentStrategy: true,
          pixelConfigs: {
            where: { isActive: true, serverSideEnabled: true },
            select: {
              id: true,
              platform: true,
              platformId: true,
              credentialsEncrypted: true,
              credentials: true,
              clientConfig: true,
            },
          },
        },
      },
    },
  });
  
  let succeeded = 0;
  let failed = 0;
  let limitExceeded = 0;
  let skipped = 0;
  
  for (const job of jobsToProcess) {
    try {
      const billingCheck = await checkBillingGate(
        job.shopId,
        (job.shop.plan || "free") as PlanId
      );
      
      if (!billingCheck.allowed) {
        logger.info(
          `Billing gate blocked job ${job.id}: ${billingCheck.reason}, ` +
          `usage=${billingCheck.usage.current}/${billingCheck.usage.limit}`
        );
        
        await prisma.conversionJob.update({
          where: { id: job.id },
          data: {
            status: "limit_exceeded",
            errorMessage: `Monthly limit exceeded: ${billingCheck.usage.current}/${billingCheck.usage.limit}`,
            lastAttemptAt: now,
          },
        });
        
        limitExceeded++;
        continue;
      }

      if (job.shop.pixelConfigs.length === 0) {
        logger.debug(`Job ${job.id}: No active platforms configured`);
        await prisma.conversionJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            processedAt: now,
            completedAt: now,
            platformResults: { message: "No platforms configured" },
          },
        });
        skipped++;
        continue;
      }

      const eventId = generateEventId(job.orderId, "purchase", job.shop.shopDomain);

      // P0-1: Get webhook checkout_token for trust verification
      const capiInputRaw = job.capiInput as { checkoutToken?: string } | null;
      const webhookCheckoutToken = capiInputRaw?.checkoutToken;
      
      let receipt = await prisma.pixelEventReceipt.findUnique({
        where: {
          shopId_orderId_eventType: {
            shopId: job.shopId,
            orderId: job.orderId,
            eventType: "purchase",
          },
        },
        select: { 
          consentState: true, 
          isTrusted: true,
          checkoutToken: true,
          orderId: true,
          trustLevel: true,
          signatureStatus: true,
        },
      });

      if (!receipt && webhookCheckoutToken) {
        receipt = await prisma.pixelEventReceipt.findFirst({
          where: {
            shopId: job.shopId,
            checkoutToken: webhookCheckoutToken,
            eventType: "purchase",
          },
          select: { 
            consentState: true, 
            isTrusted: true,
            checkoutToken: true,
            orderId: true,
            trustLevel: true,
            signatureStatus: true,
          },
        });
      }

      if (!receipt && webhookCheckoutToken) {
        const potentialReceipts = await prisma.pixelEventReceipt.findMany({
          where: {
            shopId: job.shopId,
            eventType: "purchase",
            createdAt: {
              gte: new Date(job.createdAt.getTime() - 60 * 60 * 1000),
              lte: new Date(job.createdAt.getTime() + 60 * 60 * 1000),
            },
          },
          select: { 
            consentState: true, 
            isTrusted: true,
            checkoutToken: true,
            orderId: true,
            trustLevel: true,
            signatureStatus: true,
          },
          take: 10,
        });
        
        for (const candidate of potentialReceipts) {
          if (matchKeysEqual(
            { orderId: job.orderId, checkoutToken: webhookCheckoutToken },
            { orderId: candidate.orderId, checkoutToken: candidate.checkoutToken }
          )) {
            receipt = candidate;
            break;
          }
        }
      }
      
      // P0-1: Verify receipt trust against webhook data
      const trustResult: ReceiptTrustResult = verifyReceiptTrust({
        receiptCheckoutToken: receipt?.checkoutToken,
        webhookCheckoutToken: webhookCheckoutToken,
        ingestionKeyMatched: receipt?.signatureStatus === "key_matched",
        receiptExists: !!receipt,
      });

      // P0-1: Update receipt trust level if we now have webhook verification
      if (receipt && webhookCheckoutToken && receipt.checkoutToken === webhookCheckoutToken) {
        // Promote trust level to "trusted" since checkout tokens match
        try {
          await prisma.pixelEventReceipt.update({
            where: {
              shopId_orderId_eventType: {
                shopId: job.shopId,
                orderId: receipt.orderId,
                eventType: "purchase",
              },
            },
            data: {
              trustLevel: trustResult.level,
              untrustedReason: trustResult.reason,
            },
          });
        } catch {
          // Non-critical, continue processing
        }
      }
      
      const consentState = receipt?.consentState as { 
        marketing?: boolean; 
        analytics?: boolean; 
      } | null;

      // P0-4: Build trust metadata for audit trail
      const trustMetadata = buildTrustMetadata(trustResult, {
        hasReceipt: !!receipt,
        receiptTrustLevel: receipt?.trustLevel,
        webhookHasCheckoutToken: !!webhookCheckoutToken,
      });

      const platformResults: Record<string, string> = {};
      let allSucceeded = true;
      let anySucceeded = false;
      
      // P0-4: Get consent strategy at job level for audit
      const strategy = job.shop.consentStrategy || "strict";
      
      for (const pixelConfig of job.shop.pixelConfigs) {
        
        const clientConfig = pixelConfig.clientConfig as { treatAsMarketing?: boolean } | null;
        const treatAsMarketing = clientConfig?.treatAsMarketing === true;
        const platformCategory = getEffectiveConsentCategory(pixelConfig.platform, treatAsMarketing);

        // P0-1: Check trust-based sending first
        const trustAllowed = isSendAllowedByTrust(
          trustResult,
          pixelConfig.platform,
          platformCategory,
          strategy
        );

        if (!trustAllowed.allowed) {
          logger.debug(
            `[P0-01] Skipping ${pixelConfig.platform} for job ${job.id}: ` +
            `trust check failed - ${trustAllowed.reason}`
          );
          platformResults[pixelConfig.platform] = `skipped:trust_${trustAllowed.reason}`;
          continue;
        }

        // P0-1: Use trust-verified receipt presence instead of just !!receipt
        const hasVerifiedReceipt = trustResult.trusted || trustResult.level === "partial";

        const consentDecision = evaluatePlatformConsentWithStrategy(
          pixelConfig.platform,
          strategy,
          consentState as ConsentState | null,
          hasVerifiedReceipt,
          treatAsMarketing
        );

        if (!consentDecision.allowed) {
          const skipReason = consentDecision.reason || "consent_denied";
          const usedConsent = consentDecision.usedConsent || "unknown";
          
          logger.debug(
            `[P0-07] Skipping ${pixelConfig.platform} for job ${job.id}: ` +
            `${skipReason} (consent type: ${usedConsent}, strategy: ${strategy})`
          );
          platformResults[pixelConfig.platform] = `skipped:${skipReason.replace(/\s+/g, "_").toLowerCase()}`;
          continue;
        }
        
        logger.debug(
          `[P0-07] Consent check passed for ${pixelConfig.platform} (job ${job.id}): ` +
          `strategy=${strategy}, usedConsent=${consentDecision.usedConsent}, ` +
          `trustLevel=${trustResult.level}`
        );
        try {
          
          let credentials: PlatformCredentials | null = null;
          
          if (pixelConfig.credentialsEncrypted) {
            try {
              credentials = decryptJson<PlatformCredentials>(pixelConfig.credentialsEncrypted);
            } catch {
              
            }
          }
          
          if (!credentials && (pixelConfig as Record<string, unknown>).credentials) {
            try {
              const legacyCreds = (pixelConfig as Record<string, unknown>).credentials;
              if (typeof legacyCreds === "string") {
                credentials = decryptJson<PlatformCredentials>(legacyCreds);
              } else if (typeof legacyCreds === "object" && legacyCreds !== null) {
                credentials = legacyCreds as PlatformCredentials;
              }
            } catch {
              
            }
          }
          
          if (!credentials) {
            platformResults[pixelConfig.platform] = "failed:no_credentials";
            allSucceeded = false;
            continue;
          }

          const capiInput = job.capiInput as {
            items?: Array<{ productId?: string; variantId?: string; name?: string; quantity?: number; price?: number }>;
            tax?: number;
            shipping?: number;
          } | null;

          const lineItems = capiInput?.items?.map(item => ({
            productId: item.productId || "",
            variantId: item.variantId || "",
            name: item.name || "",
            quantity: item.quantity || 1,
            price: item.price || 0,
          }));
          
          const conversionData: ConversionData = {
            orderId: job.orderId,
            orderNumber: job.orderNumber,
            value: Number(job.orderValue),
            currency: job.currency,
            
            lineItems,
          };

          let result;
          switch (pixelConfig.platform) {
            case "google":
              result = await sendConversionToGoogle(
                credentials as GoogleCredentials,
                conversionData,
                eventId
              );
              break;
            case "meta":
              result = await sendConversionToMeta(
                credentials as MetaCredentials,
                conversionData,
                eventId
              );
              break;
            case "tiktok":
              result = await sendConversionToTikTok(
                credentials as TikTokCredentials,
                conversionData,
                eventId
              );
              break;
            default:
              platformResults[pixelConfig.platform] = "failed:unsupported_platform";
              allSucceeded = false;
              continue;
          }
          
          platformResults[pixelConfig.platform] = "sent";
          anySucceeded = true;
          
        } catch (platformError) {
          const errorMsg = platformError instanceof Error ? platformError.message : "Unknown error";
          platformResults[pixelConfig.platform] = `failed:${errorMsg.substring(0, 50)}`;
          allSucceeded = false;
        }
      }

      const newAttempts = job.attempts + 1;
      
      if (allSucceeded || anySucceeded) {
        
        await prisma.conversionJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            attempts: newAttempts,
            lastAttemptAt: now,
            processedAt: now,
            completedAt: now,
            platformResults,
            errorMessage: null,
            // P0-4: Store trust and consent audit trail
            trustMetadata: trustMetadata,
            consentEvidence: {
              strategy,
              hasReceipt: !!receipt,
              receiptTrusted: trustResult.trusted,
              trustLevel: trustResult.level,
              consentState: consentState || null,
            },
          },
        });

        await incrementMonthlyUsage(job.shopId, job.orderId);
        
        succeeded++;
      } else {
        
        if (newAttempts >= job.maxAttempts) {
          
          await prisma.conversionJob.update({
            where: { id: job.id },
            data: {
              status: "dead_letter",
              attempts: newAttempts,
              lastAttemptAt: now,
              platformResults,
              errorMessage: "All platforms failed after max attempts",
            },
          });
        } else {
          
          const nextRetryAt = calculateNextRetryTime(newAttempts);
          await prisma.conversionJob.update({
            where: { id: job.id },
            data: {
              status: "failed",
              attempts: newAttempts,
              lastAttemptAt: now,
              nextRetryAt,
              platformResults,
              errorMessage: "All platforms failed, retrying...",
            },
          });
        }
        failed++;
      }
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to process job ${job.id}: ${errorMsg}`);

      await prisma.conversionJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          attempts: job.attempts + 1,
          lastAttemptAt: now,
          nextRetryAt: calculateNextRetryTime(job.attempts + 1),
          errorMessage: errorMsg,
        },
      }).catch(() => {
        
      });
      
      failed++;
    }
  }
  
  logger.info(
    `processConversionJobs: Completed - ` +
    `${succeeded} succeeded, ${failed} failed, ` +
    `${limitExceeded} limit exceeded, ${skipped} skipped`
  );
  
  return { 
    processed: jobsToProcess.length, 
    succeeded, 
    failed, 
    limitExceeded,
    skipped,
  };
}

export async function getDeadLetterItems(
  shopId: string,
  limit = 50
): Promise<Array<{
  id: string;
  orderId: string;
  orderNumber: string | null;
  platform: string;
  errorMessage: string | null;
  attempts: number;
  deadLetteredAt: Date | null;
}>> {
  const items = await prisma.conversionLog.findMany({
    where: {
      shopId,
      status: "dead_letter",
    },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      platform: true,
      errorMessage: true,
      attempts: true,
      deadLetteredAt: true,
    },
    orderBy: { deadLetteredAt: "desc" },
    take: limit,
  });

  return items;
}

export async function retryDeadLetter(logId: string): Promise<boolean> {
  const log = await prisma.conversionLog.findUnique({
    where: { id: logId },
  });

  if (!log || log.status !== "dead_letter") {
    return false;
  }

  await prisma.conversionLog.update({
    where: { id: logId },
    data: {
      status: "retrying",
      attempts: 0,
      maxAttempts: 3, 
      nextRetryAt: new Date(), 
      manuallyRetried: true,
      errorMessage: null,
    },
  });

  logger.info(`Dead letter ${logId} queued for manual retry`);
  return true;
}

export async function retryAllDeadLetters(shopId: string): Promise<number> {
  const result = await prisma.conversionLog.updateMany({
    where: {
      shopId,
      status: "dead_letter",
    },
    data: {
      status: "retrying",
      attempts: 0,
      maxAttempts: 3,
      nextRetryAt: new Date(),
      manuallyRetried: true,
      errorMessage: null,
    },
  });

  logger.info(`${result.count} dead letters queued for retry in shop ${shopId}`);
  return result.count;
}

export async function checkTokenExpirationIssues(shopId: string): Promise<{
  hasIssues: boolean;
  affectedPlatforms: string[];
}> {
  
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const tokenExpiredLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      status: { in: ["failed", "dead_letter"] },
      errorMessage: { contains: "[token_expired]" },
      lastAttemptAt: { gte: oneDayAgo },
    },
    select: {
      platform: true,
    },
    distinct: ["platform"],
  });

  const affectedPlatforms = tokenExpiredLogs.map((l) => l.platform);

  return {
    hasIssues: affectedPlatforms.length > 0,
    affectedPlatforms,
  };
}

export async function getRetryStats(shopId: string): Promise<{
  pending: number;
  retrying: number;
  deadLetter: number;
  sent: number;
  failed: number;
}> {
  const stats = await prisma.conversionLog.groupBy({
    by: ["status"],
    where: { shopId },
    _count: true,
  });

  const result = {
    pending: 0,
    retrying: 0,
    deadLetter: 0,
    sent: 0,
    failed: 0,
  };

  for (const stat of stats) {
    switch (stat.status) {
      case "pending":
        result.pending = stat._count;
        break;
      case "retrying":
        result.retrying = stat._count;
        break;
      case "dead_letter":
        result.deadLetter = stat._count;
        break;
      case "sent":
        result.sent = stat._count;
        break;
      case "failed":
        result.failed = stat._count;
        break;
    }
  }

  return result;
}
