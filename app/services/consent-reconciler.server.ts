/**
 * Consent Reconciliation Service
 * 
 * P0-6: Handles the case where webhook arrives before pixel event
 * 
 * Problem:
 * - Webhook creates ConversionLog with status="pending_consent" when no pixel receipt exists
 * - User may later accept cookies, causing pixel to fire (and PixelEventReceipt to be created)
 * - Without this reconciler, the order stays stuck in pending_consent forever
 * 
 * Solution:
 * - Periodically scan pending_consent logs
 * - Check if PixelEventReceipt has arrived
 * - If consent allows (based on shop's strategy), move to pending for processing
 * - If timeout (24h), move to dead_letter with explanation
 */

import prisma from "../db.server";
import { logger } from "../utils/logger";

// Timeout after which pending_consent logs are moved to dead_letter
const CONSENT_TIMEOUT_HOURS = 24;

// Batch size for processing
const BATCH_SIZE = 100;

interface ConsentReconciliationResult {
  processed: number;
  resolved: number;
  expired: number;
  errors: number;
}

/**
 * Evaluate consent based on shop strategy and pixel receipt
 * Returns whether CAPI sending should be allowed
 */
function evaluateConsent(
  strategy: string,
  consentState: { marketing?: boolean; analytics?: boolean } | null
): { allowed: boolean; reason: string } {
  switch (strategy) {
    case "strict":
      // Must have explicit marketing consent
      if (!consentState) {
        return { allowed: false, reason: "No consent state (strict mode)" };
      }
      if (consentState.marketing !== true) {
        return { allowed: false, reason: "Marketing consent not granted (strict mode)" };
      }
      return { allowed: true, reason: "Marketing consent granted" };
      
    case "balanced":
      // If we have consent state, respect it
      if (consentState) {
        if (consentState.marketing === false) {
          return { allowed: false, reason: "Marketing consent explicitly denied" };
        }
        // If marketing is true or undefined (not explicitly denied), allow
        return { allowed: true, reason: "Consent received, marketing not denied" };
      }
      // No consent state - don't send
      return { allowed: false, reason: "No consent state (balanced mode)" };
      
    case "weak":
      // Always allow (for regions with implied consent)
      return { allowed: true, reason: "Weak consent mode - always allow" };
      
    default:
      // Default to balanced behavior
      if (consentState && consentState.marketing !== false) {
        return { allowed: true, reason: "Default: consent received" };
      }
      return { allowed: false, reason: "Default: no consent or denied" };
  }
}

/**
 * Reconcile pending_consent ConversionLogs
 * 
 * This function:
 * 1. Finds all pending_consent logs
 * 2. Checks if corresponding PixelEventReceipt exists
 * 3. If receipt exists and consent allows, moves to pending
 * 4. If receipt exists and consent denies, moves to dead_letter
 * 5. If no receipt and timeout exceeded, moves to dead_letter
 * 
 * @returns Statistics about what was processed
 */
export async function reconcilePendingConsent(): Promise<ConsentReconciliationResult> {
  const cutoffTime = new Date(Date.now() - CONSENT_TIMEOUT_HOURS * 60 * 60 * 1000);
  
  // Find pending_consent logs
  const pendingLogs = await prisma.conversionLog.findMany({
    where: { 
      status: "pending_consent",
    },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          consentStrategy: true,
          weakConsentMode: true, // Legacy fallback
        },
      },
    },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" }, // Process oldest first
  });
  
  if (pendingLogs.length === 0) {
    return { processed: 0, resolved: 0, expired: 0, errors: 0 };
  }
  
  logger.info(`Consent reconciler: processing ${pendingLogs.length} pending_consent logs`);
  
  let resolved = 0;
  let expired = 0;
  let errors = 0;
  
  for (const log of pendingLogs) {
    try {
      // Check if PixelEventReceipt exists for this order
      const receipt = await prisma.pixelEventReceipt.findUnique({
        where: {
          shopId_orderId_eventType: {
            shopId: log.shopId,
            orderId: log.orderId,
            eventType: log.eventType,
          },
        },
        select: {
          consentState: true,
          isTrusted: true,
          pixelTimestamp: true,
        },
      });
      
      if (receipt) {
        // Receipt exists - evaluate consent
        const strategy = log.shop.consentStrategy || (log.shop.weakConsentMode ? "weak" : "balanced");
        const consentState = receipt.consentState as { marketing?: boolean; analytics?: boolean } | null;
        
        const decision = evaluateConsent(strategy, consentState);
        
        if (decision.allowed) {
          // Move to pending for processing
          await prisma.conversionLog.update({
            where: { id: log.id },
            data: {
              status: "pending",
              attempts: 0,
              nextRetryAt: null,
              errorMessage: null,
              // Mark that we received consent via reconciliation
              clientSideSent: true,
            },
          });
          
          logger.info(`Consent reconciled for ${log.shopId}/${log.orderId}: ${decision.reason}`, {
            orderId: log.orderId,
            platform: log.platform,
            strategy,
            receiptTrusted: receipt.isTrusted,
          });
          
          resolved++;
        } else {
          // Consent denied - move to dead_letter
          await prisma.conversionLog.update({
            where: { id: log.id },
            data: {
              status: "dead_letter",
              deadLetteredAt: new Date(),
              errorMessage: `Consent denied: ${decision.reason}`,
            },
          });
          
          logger.info(`Consent denied for ${log.shopId}/${log.orderId}: ${decision.reason}`, {
            orderId: log.orderId,
            platform: log.platform,
            strategy,
          });
          
          // This counts as "resolved" in terms of processing
          resolved++;
        }
      } else {
        // No receipt yet - check if we've exceeded timeout
        if (log.createdAt < cutoffTime) {
          // Timeout exceeded - move to dead_letter
          await prisma.conversionLog.update({
            where: { id: log.id },
            data: {
              status: "dead_letter",
              deadLetteredAt: new Date(),
              errorMessage: `Consent timeout: no pixel event received within ${CONSENT_TIMEOUT_HOURS} hours`,
            },
          });
          
          logger.warn(`Consent timeout for ${log.shopId}/${log.orderId}`, {
            orderId: log.orderId,
            platform: log.platform,
            createdAt: log.createdAt.toISOString(),
            timeoutHours: CONSENT_TIMEOUT_HOURS,
          });
          
          expired++;
        }
        // else: Still waiting for pixel event, leave as pending_consent
      }
    } catch (error) {
      logger.error(`Error reconciling consent for ${log.id}`, error);
      errors++;
    }
  }
  
  const result = {
    processed: pendingLogs.length,
    resolved,
    expired,
    errors,
  };
  
  logger.info(`Consent reconciliation completed`, result);
  
  return result;
}

/**
 * Get statistics about pending_consent logs
 * Useful for monitoring dashboard
 */
export async function getConsentPendingStats(): Promise<{
  total: number;
  approaching_timeout: number;
  by_shop: Array<{ shopDomain: string; count: number }>;
}> {
  const approachingTimeoutCutoff = new Date(
    Date.now() - (CONSENT_TIMEOUT_HOURS - 4) * 60 * 60 * 1000
  ); // Within 4 hours of timeout
  
  const [total, approachingTimeout, byShop] = await Promise.all([
    prisma.conversionLog.count({
      where: { status: "pending_consent" },
    }),
    prisma.conversionLog.count({
      where: {
        status: "pending_consent",
        createdAt: { lt: approachingTimeoutCutoff },
      },
    }),
    prisma.conversionLog.groupBy({
      by: ["shopId"],
      where: { status: "pending_consent" },
      _count: true,
    }).then(async (groups) => {
      // Get shop domains for the group
      const shopIds = groups.map(g => g.shopId);
      const shops = await prisma.shop.findMany({
        where: { id: { in: shopIds } },
        select: { id: true, shopDomain: true },
      });
      const shopMap = new Map(shops.map(s => [s.id, s.shopDomain]));
      
      return groups.map(g => ({
        shopDomain: shopMap.get(g.shopId) || g.shopId,
        count: g._count,
      }));
    }),
  ]);
  
  return {
    total,
    approaching_timeout: approachingTimeout,
    by_shop: byShop,
  };
}
