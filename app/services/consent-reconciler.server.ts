

import prisma from "../db.server";
import { logger } from "../utils/logger";

const CONSENT_TIMEOUT_HOURS = 24;

const BATCH_SIZE = 100;

interface ConsentReconciliationResult {
  processed: number;
  resolved: number;
  expired: number;
  errors: number;
}

function evaluateConsent(
  strategy: string,
  consentState: { marketing?: boolean; analytics?: boolean } | null
): { allowed: boolean; reason: string } {
  switch (strategy) {
    case "strict":
      
      if (!consentState) {
        return { allowed: false, reason: "No consent state (strict mode)" };
      }
      if (consentState.marketing !== true) {
        return { allowed: false, reason: "Marketing consent not granted (strict mode)" };
      }
      return { allowed: true, reason: "Marketing consent granted" };
      
    case "balanced":
      
      if (consentState) {
        if (consentState.marketing === false) {
          return { allowed: false, reason: "Marketing consent explicitly denied" };
        }
        
        return { allowed: true, reason: "Consent received, marketing not denied" };
      }
      
      return { allowed: false, reason: "No consent state (balanced mode)" };
      
    case "weak":
      
      return { allowed: true, reason: "Weak consent mode - always allow" };
      
    default:
      
      if (consentState && consentState.marketing !== false) {
        return { allowed: true, reason: "Default: consent received" };
      }
      return { allowed: false, reason: "Default: no consent or denied" };
  }
}

export async function reconcilePendingConsent(): Promise<ConsentReconciliationResult> {
  const cutoffTime = new Date(Date.now() - CONSENT_TIMEOUT_HOURS * 60 * 60 * 1000);

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
          weakConsentMode: true, 
        },
      },
    },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" }, 
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

      let receipt = await prisma.pixelEventReceipt.findUnique({
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

      if (!receipt) {
        
        const job = await prisma.conversionJob.findUnique({
          where: { shopId_orderId: { shopId: log.shopId, orderId: log.orderId } },
          select: { capiInput: true },
        });
        
        const checkoutToken = (job?.capiInput as { checkoutToken?: string } | null)?.checkoutToken;
        if (checkoutToken) {
          
          receipt = await prisma.pixelEventReceipt.findFirst({
            where: {
              shopId: log.shopId,
              checkoutToken,
              eventType: log.eventType,
            },
            select: {
              consentState: true,
              isTrusted: true,
              pixelTimestamp: true,
            },
          });
          
          if (receipt) {
            logger.info(`P0-11: Found receipt by checkoutToken for ${log.orderId}`, {
              checkoutToken,
              orderId: log.orderId,
            });
          }
        }
      }
      
      if (receipt) {
        
        const strategy = log.shop.consentStrategy || (log.shop.weakConsentMode ? "weak" : "balanced");
        const consentState = receipt.consentState as { marketing?: boolean; analytics?: boolean } | null;
        
        const decision = evaluateConsent(strategy, consentState);
        
        if (decision.allowed) {
          
          await prisma.conversionLog.update({
            where: { id: log.id },
            data: {
              status: "pending",
              attempts: 0,
              nextRetryAt: null,
              errorMessage: null,
              
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

          resolved++;
        }
      } else {
        
        if (log.createdAt < cutoffTime) {
          
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

export async function getConsentPendingStats(): Promise<{
  total: number;
  approaching_timeout: number;
  by_shop: Array<{ shopDomain: string; count: number }>;
}> {
  const approachingTimeoutCutoff = new Date(
    Date.now() - (CONSENT_TIMEOUT_HOURS - 4) * 60 * 60 * 1000
  ); 
  
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
