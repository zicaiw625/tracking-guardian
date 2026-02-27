import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { Prisma } from "@prisma/client";
import { trackEvent } from "./analytics.server";
import { safeFireAndForget } from "../utils/helpers.server";
import { normalizePlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";
import { randomUUID } from "crypto";
import { extractEventData } from "../utils/receipt-parser";
import { performEnhancedChannelReconciliation } from "./verification/channel-reconciliation.server";
import { z } from "zod";

export interface VerificationTestItem {
  id: string;
  name: string;
  description: string;
  eventType: string;
  required: boolean;
  platforms: string[];
}

export const VERIFICATION_TEST_ITEMS: VerificationTestItem[] = [
  {
    id: "purchase",
    name: "Standard Purchase",
    description: "Complete a standard order with a single item to verify the purchase event fires correctly",
    eventType: "purchase",
    required: true,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_multi",
    name: "Multi-Item Purchase",
    description: "Complete an order with multiple different items to verify items array completeness",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_discount",
    name: "Discounted Order",
    description: "Complete an order using a discount code to verify the final amount (original price - discount) is calculated correctly",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_shipping",
    name: "Order with Shipping",
    description: "Complete an order that includes shipping fees to verify the total amount (items + shipping) is correct",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "purchase_complex",
    name: "Complex Order (Multi-Item + Discount + Shipping)",
    description: "Complete a full order with multiple items, a discount code, and shipping fees to verify all parameters are correct",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
  {
    id: "currency_test",
    name: "Multi-Currency Test",
    description: "Complete an order using a non-USD currency to verify the currency parameter is correct",
    eventType: "purchase",
    required: false,
    platforms: ["google", "meta", "tiktok"],
  },
];

export interface VerificationEventResult {
  testItemId: string;
  eventType: string;
  platform: string;
  orderId?: string;
  orderNumber?: string;
  status: "success" | "failed" | "missing_params" | "not_tested" | "deduplicated" | "warning";
  triggeredAt?: Date;
  params?: {
    value?: number;
    currency?: string;
    items?: number;
    hasEventId?: boolean;
  };
  shopifyOrder?: {
    value: number;
    currency: string;
    itemCount: number;
  };
  discrepancies?: string[];
  errors?: string[];
  dedupInfo?: {
    existingEventId?: string;
    reason?: string;
  };
}

export interface VerificationSummary {
  runId: string;
  shopId: string;
  runName: string;
  runType: "quick" | "full" | "custom";
  status: "pending" | "running" | "completed" | "failed";
  platforms: string[];
  startedAt?: Date;
  completedAt?: Date;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  missingParamTests: number;
  notTestedCount: number;
  parameterCompleteness: number;
  valueAccuracy: number;
  results: VerificationEventResult[];
  platformResults?: Record<string, { sent: number; failed: number }>;
  limitReached?: boolean;
  reconciliation?: {
    pixelVsCapi: {
      pixelOnly: number;
      capiOnly: number;
      both: number;
      consentBlocked: number;
    };
    consistencyIssues?: Array<{
      orderId: string;
      issue: string;
      type: "value_mismatch" | "currency_mismatch" | "missing" | "duplicate";
    }>;
    localConsistency?: {
      totalChecked: number;
      consistent: number;
      partial: number;
      inconsistent: number;
      issues: Array<{
        orderId: string;
        status: "consistent" | "partial" | "inconsistent";
        issues: string[];
      }>;
    };
  };
  reconciliationError?: string;
}

export async function createVerificationRun(
  shopId: string,
  options: {
    runName?: string;
    runType?: "quick" | "full" | "custom";
    platforms?: string[];
    testItems?: string[];
  }
): Promise<string> {
  const { runName = "Verification Test", runType = "quick", platforms = [] } = options;
  let targetPlatforms = platforms;
  if (targetPlatforms.length === 0) {
    const configs = await prisma.pixelConfig.findMany({
      where: { shopId, isActive: true },
      select: { platform: true },
    });
    targetPlatforms = configs.map((c: { platform: string }) => c.platform);
  }
  const run = await prisma.verificationRun.create({
    data: {
      id: randomUUID(),
      shopId,
      runName,
      runType,
      status: "pending",
      platforms: targetPlatforms,
      summaryJson: {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        missingParamTests: 0,
      },
      eventsJson: [],
    },
  });
  logger.info("Created verification run", { runId: run.id, shopId, runType });
  return run.id;
}

export async function startVerificationRun(runId: string): Promise<void> {
  const updated = await prisma.verificationRun.updateMany({
    where: { id: runId, status: "pending" },
    data: {
      status: "running",
      startedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    throw new Error(`Verification run ${runId} is not in pending state`);
  }
}

// Define Zod schema for runtime validation of stored JSON
const VerificationEventResultSchema = z.object({
  testItemId: z.string(),
  eventType: z.string(),
  platform: z.string(),
  status: z.string(), // Allow string to be forward compatible, though typed as enum in TS
  orderId: z.string().optional(),
  orderNumber: z.string().optional(),
  triggeredAt: z.string().or(z.date()).optional().transform(val => val ? new Date(val) : undefined),
  params: z.record(z.string(), z.unknown()).optional(),
  shopifyOrder: z.object({
    value: z.number(),
    currency: z.string(),
    itemCount: z.number()
  }).optional(),
  discrepancies: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
  dedupInfo: z.object({
    existingEventId: z.string().optional(),
    reason: z.string().optional()
  }).optional()
}).passthrough();

const EventsJsonSchema = z.array(VerificationEventResultSchema);

export async function getVerificationRun(runId: string): Promise<VerificationSummary | null> {
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      shopId: true,
      runName: true,
      runType: true,
      status: true,
      platforms: true,
      summaryJson: true,
      eventsJson: true,
      startedAt: true,
      completedAt: true,
      Shop: {
        select: { shopDomain: true },
      },
    },
  });
  if (!run) return null;
  const summary = run.summaryJson as Record<string, unknown> | null;
  
  let events: VerificationEventResult[] = [];
  try {
    // Safe parsing of eventsJson
    if (run.eventsJson) {
      // Prisma Json can be anything, ensure it's an array first
      const parsed = EventsJsonSchema.safeParse(run.eventsJson);
      if (parsed.success) {
        events = parsed.data as unknown as VerificationEventResult[];
      } else {
        logger.warn("Validation failed for eventsJson", { runId, errors: parsed.error.format() });
        // Fallback: try to cast if it looks like an array, or empty
        if (Array.isArray(run.eventsJson)) {
             events = run.eventsJson as unknown as VerificationEventResult[];
        }
      }
    }
  } catch (e) {
      logger.error("Unexpected error parsing eventsJson", { runId, error: e });
  }

  const reconciliation = summary?.reconciliation as VerificationSummary["reconciliation"] | undefined;
  const platformResults = (summary?.platformResults as Record<string, { sent: number; failed: number }>) || undefined;
  return {
    runId: run.id,
    shopId: run.shopId,
    runName: run.runName,
    runType: run.runType as "quick" | "full" | "custom",
    status: run.status as "pending" | "running" | "completed" | "failed",
    platforms: run.platforms,
    startedAt: run.startedAt || undefined,
    completedAt: run.completedAt || undefined,
    totalTests: (summary?.totalTests as number) || 0,
    passedTests: (summary?.passedTests as number) || 0,
    failedTests: (summary?.failedTests as number) || 0,
    missingParamTests: (summary?.missingParamTests as number) || 0,
    notTestedCount: (summary?.notTestedCount as number) || 0,
    parameterCompleteness: (summary?.parameterCompleteness as number) || 0,
    valueAccuracy: (summary?.valueAccuracy as number) || 0,
    results: events,
    platformResults,
    limitReached: (summary?.limitReached as boolean) || false,
    reconciliation,
    reconciliationError: summary?.reconciliationError as string | undefined,
  };
}

export async function analyzeRecentEvents(
  shopId: string,
  runId: string,
  options: {
    since?: Date;
    platforms?: string[];
    admin?: AdminApiContext;
  } = {}
): Promise<VerificationSummary> {
  const { since = new Date(Date.now() - 24 * 60 * 60 * 1000), platforms } = options;
  const LIMIT = 1000;
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      shopId: true,
      platforms: true,
      runType: true,
      runName: true,
      startedAt: true,
    },
  });
  if (!run) {
    throw new Error("Verification run not found");
  }
  if (run.shopId !== shopId) {
    throw new Error("Verification run does not belong to the provided shop");
  }
  const targetPlatforms = platforms || run.platforms;
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      pixelTimestamp: { gte: since },
    },
    orderBy: { pixelTimestamp: "desc" },
    take: LIMIT,
    select: {
      id: true,
      eventId: true,
      eventType: true,
      platform: true,
      payloadJson: true,
      pixelTimestamp: true,
      createdAt: true,
      orderKey: true,
      totalValue: true,
      currency: true,
    },
  });
  const limitReached = receipts.length >= LIMIT;

  const orderKeysFromReceipts = [...new Set(receipts.map((r) => {
    if (r.orderKey) return r.orderKey;
    const { orderId } = extractEventData(r.payloadJson);
    return orderId;
  }).filter(Boolean) as string[])];
  const orderSummaries = orderKeysFromReceipts.length > 0
    ? await prisma.orderSummary.findMany({
        where: { shopId, orderId: { in: orderKeysFromReceipts } },
        select: { orderId: true, totalPrice: true, currency: true },
      })
    : [];
  const orderSummaryMap = new Map(
    orderSummaries.map((o) => [o.orderId, { totalPrice: Number(o.totalPrice), currency: o.currency }])
  );

  // Pre-fetch potential duplicates for purchase events (Fix N+1)
  const purchaseOrderKeys = receipts
    .filter((r) => r.eventType === "purchase" && r.orderKey)
    .map((r) => r.orderKey as string);
  
  const duplicateMap = new Map<string, Array<{ id: string; createdAt: Date; pixelTimestamp: Date; eventId: string }>>();
  
  if (purchaseOrderKeys.length > 0) {
    const potentialDuplicates = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        eventType: "purchase",
        orderKey: { in: purchaseOrderKeys },
      },
      select: { id: true, orderKey: true, createdAt: true, pixelTimestamp: true, eventId: true },
      orderBy: { pixelTimestamp: "desc" },
    });
    
    for (const r of potentialDuplicates) {
      if (!r.orderKey) continue;
      const list = duplicateMap.get(r.orderKey) || [];
      list.push(r);
      duplicateMap.set(r.orderKey, list);
    }
  }

  const results: VerificationEventResult[] = [];
  let passedTests = 0;
  let failedTests = 0;
  let missingParamTests = 0;
  let totalValueAccuracy = 0;
  let valueChecks = 0;
  const orderIds = new Set<string>();
  const consistencyIssues: Array<{ orderId: string; issue: string; type: "value_mismatch" | "currency_mismatch" | "missing" | "duplicate" }> = [];
  const platformResults: Record<string, { sent: number; failed: number }> = {};
  
  // Perform Order Reconciliation to find missing orders
  const hours = Math.ceil((Date.now() - since.getTime()) / (60 * 60 * 1000));
  let reconciliationError: string | undefined;
  let reconciliationLimitReached = false;
  try {
    const reconciliationResult = await performEnhancedChannelReconciliation(shopId, Math.max(1, hours), targetPlatforms);
    reconciliationLimitReached = reconciliationResult.summary.limitReached;
    
    // Add missing orders to results and consistencyIssues
    for (const platformComp of reconciliationResult.platforms) {
      const p = platformComp.platform;
      
      for (const missing of platformComp.stats.missingOrders) {
        failedTests++;
        
        if (!platformResults[p]) platformResults[p] = { sent: 0, failed: 0 };
        platformResults[p].failed++;
        
        results.push({
          testItemId: "purchase_completeness",
          eventType: "purchase",
          platform: p,
          orderId: missing.orderId,
          status: "failed",
          triggeredAt: undefined, // No event triggered
          params: {
             value: missing.orderValue,
             currency: missing.currency
          },
          discrepancies: ["Order not tracked (missing)"],
          errors: ["Missing Pixel Event"]
        });

        consistencyIssues.push({
          orderId: missing.orderId,
          issue: `[${p}] Missing order: order value ${missing.orderValue} ${missing.currency} not tracked`,
          type: "missing"
        });
      }
    }
  } catch (e) {
    logger.error("Failed to perform reconciliation in verification run", { error: e });
    reconciliationError = e instanceof Error ? e.message : "Unknown reconciliation error";
  }

  for (const p of targetPlatforms) {
    if (!platformResults[p]) {
      platformResults[p] = { sent: 0, failed: 0 };
    }
  }
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const { value: parsedValue, currency: parsedCurrency, items, platform: extractedPlatform } = extractEventData(payload);
    
    // Prefer DB columns (indexed/cached), fallback to parsed JSON
    const value = receipt.totalValue ? Number(receipt.totalValue) : parsedValue;
    const currency = receipt.currency || parsedCurrency;
    
    const platform = receipt.platform ?? extractedPlatform;
    
    if (!platform || (targetPlatforms.length > 0 && !targetPlatforms.includes(platform))) {
      continue;
    }
    const orderId = receipt.orderKey || (payload?.data as Record<string, unknown>)?.orderId as string | undefined;
    if (orderId) {
      orderIds.add(orderId);
    }
    const discrepancies: string[] = [];
    const hasValue = value !== undefined && value !== null;
    const hasCurrency = !!currency;
    const hasEventId = !!payload?.eventId || !!receipt.eventId;
    let dedupInfo: { existingEventId?: string; reason?: string } | undefined;
    if (receipt.eventType !== "purchase") {
      const hasBasicFields = !!payload?.eventId && !!(payload?.eventName ?? receipt.eventType);
      if (hasBasicFields) {
        passedTests++;
        const p = platform || "unknown";
        if (!platformResults[p]) platformResults[p] = { sent: 0, failed: 0 };
        platformResults[p].sent++;
        results.push({
          testItemId: receipt.eventType,
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          orderNumber: undefined,
          status: "success",
          triggeredAt: receipt.pixelTimestamp,
          params: { hasEventId },
          discrepancies: undefined,
          errors: undefined,
          dedupInfo: undefined,
        });
      } else {
        missingParamTests++;
        const p = platform || "unknown";
        if (!platformResults[p]) platformResults[p] = { sent: 0, failed: 0 };
        platformResults[p].failed++;
        const disc: string[] = [];
        if (!payload?.eventId) disc.push("Missing eventId");
        if (!(payload?.eventName ?? receipt.eventType)) disc.push("Missing eventName");
        results.push({
          testItemId: receipt.eventType,
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          orderNumber: undefined,
          status: "missing_params",
          triggeredAt: receipt.pixelTimestamp,
          params: { hasEventId },
          discrepancies: disc.length > 0 ? disc : undefined,
          errors: undefined,
          dedupInfo: undefined,
        });
      }
      continue;
    }
    if (orderId && receipt.eventType === "purchase") {
      const history = duplicateMap.get(orderId);
      if (history) {
        const existingReceipt = history.find(
          (h) => h.id !== receipt.id && h.pixelTimestamp < receipt.pixelTimestamp
        );
        if (existingReceipt) {
          dedupInfo = {
            existingEventId: existingReceipt.eventId,
            reason: `Same order event already recorded at ${existingReceipt.pixelTimestamp.toISOString()}`,
          };
        }
      }
    }
    const p = platform || "unknown";
    if (!platformResults[p]) platformResults[p] = { sent: 0, failed: 0 };
    if (hasValue && hasCurrency) {
      if (dedupInfo) {
        results.push({
          testItemId: "purchase",
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          orderNumber: undefined,
          status: "deduplicated",
          triggeredAt: receipt.pixelTimestamp,
          params: {
            value: value ?? undefined,
            currency: currency || undefined,
            items: items || undefined,
            hasEventId,
          },
          discrepancies: undefined,
          errors: undefined,
          dedupInfo,
        });
      } else {
        platformResults[p].sent++;
        const orderSummary = orderId ? orderSummaryMap.get(orderId) : undefined;
        let isFailed = false;
        let discrepancyNote: string | undefined;
        
        if (orderSummary) {
          valueChecks++;
          const hasPixelValue = value !== undefined && value !== null;
          const valueMatch = hasPixelValue && Math.abs((value as number) - orderSummary.totalPrice) < 0.01;
          const currencyMatch = (currency ?? "").toUpperCase() === (orderSummary.currency ?? "").toUpperCase();
          if (valueMatch && currencyMatch) {
            totalValueAccuracy += 100;
          } else {
            isFailed = true;
            if (!hasPixelValue) {
                const msg = `Pixel event missing value data`;
                consistencyIssues.push({ orderId: orderId!, issue: msg, type: "value_mismatch" });
                if (!discrepancyNote) discrepancyNote = msg;
                else discrepancyNote += `; ${msg}`;
            } else if (!valueMatch && orderId) {
              const msg = `Value mismatch: Pixel=${value}, Order=${orderSummary.totalPrice}`;
              consistencyIssues.push({
                orderId,
                issue: msg,
                type: "value_mismatch",
              });
              if (!discrepancyNote) discrepancyNote = msg;
              else discrepancyNote += `; ${msg}`;
            }
            if (!currencyMatch && orderId) {
              const msg = `Currency mismatch: Pixel=${currency}, Order=${orderSummary.currency}`;
              consistencyIssues.push({
                orderId,
                issue: msg,
                type: "currency_mismatch",
              });
              if (!discrepancyNote) discrepancyNote = msg;
              else discrepancyNote += `; ${msg}`;
            }
          }
        } else {
          // Fix P1-5: Do not default to 100% accuracy if order summary is missing.
          // We simply skip the value check and mark as "not verified" for value.
          discrepancyNote = "Order details not yet synced (please wait 1-2 minutes and retry), skipping value reconciliation";
        }

        if (isFailed) {
          failedTests++;
          platformResults[p].failed++;
          results.push({
            testItemId: "purchase",
            eventType: receipt.eventType,
            platform: p,
            orderId: orderId || undefined,
            orderNumber: undefined,
            status: "failed",
            triggeredAt: receipt.pixelTimestamp,
            params: {
              value: value ?? undefined,
              currency: currency || undefined,
              items: items || undefined,
              hasEventId,
            },
            discrepancies: discrepancyNote ? [discrepancyNote] : ["Value or currency mismatch with order"],
            errors: undefined,
            dedupInfo,
          });
        } else {
          passedTests++;
          results.push({
            testItemId: "purchase",
            eventType: receipt.eventType,
            platform: p,
            orderId: orderId || undefined,
            orderNumber: undefined,
            status: discrepancyNote ? "warning" : "success",
            triggeredAt: receipt.pixelTimestamp,
            params: {
              value: value ?? undefined,
              currency: currency || undefined,
              items: items || undefined,
              hasEventId,
            },
            discrepancies: discrepancyNote ? [discrepancyNote] : undefined,
            errors: undefined,
            dedupInfo,
          });

          // Check for specific test scenarios
          if (items && items > 1) {
             results.push({
              testItemId: "purchase_multi",
              eventType: "purchase (multi-item)",
              platform: p,
              orderId: orderId || undefined,
              status: "success",
              triggeredAt: receipt.pixelTimestamp,
              params: { items },
             });
             passedTests++; 
          }
          
          if (currency && currency !== "USD") { 
             results.push({
              testItemId: "currency_test",
              eventType: "purchase (currency)",
              platform: p,
              orderId: orderId || undefined,
              status: "success",
              triggeredAt: receipt.pixelTimestamp,
              params: { currency },
             });
             passedTests++;
          }
        }
      }
    } else {
      missingParamTests++;
      platformResults[p].failed++;
      if (!hasValue) discrepancies.push("Missing value parameter");
      if (!hasCurrency) discrepancies.push("Missing currency parameter");
      results.push({
        testItemId: "purchase",
        eventType: receipt.eventType,
        platform: p,
        orderId: orderId || undefined,
        orderNumber: undefined,
        status: "missing_params",
        triggeredAt: receipt.pixelTimestamp,
        params: {
          value: value ?? undefined,
          currency: currency || undefined,
          items: items || undefined,
          hasEventId,
        },
        discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
        errors: undefined,
        dedupInfo,
      });
    }
  }
  const totalTests = results.length;
  const parameterCompleteness =
    totalTests > 0 ? Math.round(((passedTests + missingParamTests) / totalTests) * 100) : 0;
  // If no value checks were performed, default to 0 to avoid misleading 100% accuracy
  const valueAccuracy = valueChecks > 0 ? Math.round(totalValueAccuracy / valueChecks) : 0;
  const reconciliation: VerificationSummary["reconciliation"] | undefined =
    consistencyIssues.length > 0
      ? {
          pixelVsCapi: { pixelOnly: 0, capiOnly: 0, both: 0, consentBlocked: 0 },
          consistencyIssues,
        }
      : undefined;
  await prisma.verificationRun.update({
    where: { id: runId },
    data: {
      status: "completed",
      completedAt: new Date(),
      summaryJson: {
        totalTests,
        passedTests,
        failedTests,
        missingParamTests,
        notTestedCount: 0,
        parameterCompleteness,
        valueAccuracy,
        platformResults,
        reconciliation,
        limitReached: limitReached || reconciliationLimitReached,
        reconciliationError,
      },
      eventsJson: results as unknown as Prisma.InputJsonValue,
    },
  });
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true },
  });
  if (shop) {
        const shopRecord = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { plan: true },
    });
    const planId = normalizePlanId(shopRecord?.plan ?? "free");
    const isAgency = isPlanAtLeast(planId, "agency");
    const verificationPassRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
        const pixelConfigs = await prisma.pixelConfig.findMany({
      where: {
        shopId,
        isActive: true,
        platform: { in: targetPlatforms },
      },
      select: {
        platform: true,
        environment: true,
      },
      take: 1,
    });
    const destinationType = pixelConfigs.length > 0 ? pixelConfigs[0].platform : targetPlatforms[0] || "none";
    const environment = pixelConfigs.length > 0 ? pixelConfigs[0].environment : "live";
        const firstEventName = receipts.length > 0 ? receipts[0].eventType : undefined;
        let riskScore: number | undefined;
    let assetCount: number | undefined;
    try {
      const latestScan = await prisma.scanReport.findFirst({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        select: { riskScore: true },
      });
      if (latestScan) {
        riskScore = latestScan.riskScore;
        const assets = await prisma.auditAsset.count({
          where: { shopId },
        });
        assetCount = assets;
      }
    } catch {
      // no-op: ignore errors when counting assets
    }
        safeFireAndForget(
      trackEvent({
        shopId,
        shopDomain: shop.shopDomain,
        event: "ver_run_completed",
        eventId: `ver_run_completed_${runId}`,
        metadata: {
          run_id: runId,
          run_type: run.runType,
          platforms: targetPlatforms,
          plan: shopRecord?.plan ?? "free",
          role: isAgency ? "agency" : "merchant",
          verification_pass_rate: verificationPassRate,
          total_tests: totalTests,
          passed_tests: passedTests,
          failed_tests: failedTests,
          missing_param_tests: missingParamTests,
          parameter_completeness: parameterCompleteness,
          value_accuracy: valueAccuracy,
          destination_type: destinationType,
          environment: environment,
          first_event_name: firstEventName,
          risk_score: riskScore,
          asset_count: assetCount,
        },
      })
    );
  }
  return {
    runId,
    shopId,
    runName: run.runName,
    runType: run.runType as "quick" | "full" | "custom",
    status: "completed",
    platforms: targetPlatforms,
    startedAt: run.startedAt || undefined,
    completedAt: new Date(),
    totalTests,
    passedTests,
    failedTests,
    missingParamTests,
    notTestedCount: 0,
    parameterCompleteness,
    valueAccuracy,
    results,
    platformResults,
    limitReached,
    reconciliation,
    reconciliationError,
  };
}

export async function getVerificationHistory(
  shopId: string,
  limit = 10
): Promise<VerificationSummary[]> {
  const runs = await prisma.verificationRun.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      shopId: true,
      runName: true,
      runType: true,
      status: true,
      platforms: true,
      summaryJson: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });
  return runs.map((run) => {
    const summary = run.summaryJson as Record<string, unknown> | null;
    return {
      runId: run.id,
      shopId: run.shopId,
      runName: run.runName,
      runType: (run.runType || "quick") as "quick" | "full" | "custom",
      status: (run.status || "pending") as "pending" | "running" | "completed" | "failed",
      platforms: run.platforms || [],
      startedAt: run.startedAt || undefined,
      completedAt: run.completedAt || undefined,
      totalTests: (summary?.totalTests as number) || 0,
      passedTests: (summary?.passedTests as number) || 0,
      failedTests: (summary?.failedTests as number) || 0,
      missingParamTests: (summary?.missingParamTests as number) || 0,
      notTestedCount: (summary?.notTestedCount as number) || 0,
      parameterCompleteness: (summary?.parameterCompleteness as number) || 0,
      valueAccuracy: (summary?.valueAccuracy as number) || 0,
      results: [],
    };
  });
}

export function generateTestOrderGuide(runType: "quick" | "full" | "custom"): {
  steps: Array<{
    step: number;
    title: string;
    description: string;
    testItemId: string;
  }>;
  estimatedTime: string;
  tips: string[];
} {
  const quickSteps = [
    {
      step: 1,
      title: "Create Test Order",
      description: "Add items to cart on your storefront and complete checkout. Use Bogus Gateway or Shopify Payments test mode.",
      testItemId: "purchase",
    },
    {
      step: 2,
      title: "Wait for Event Processing",
      description: "Wait 1-2 minutes for the system to process the order webhook and pixel events.",
      testItemId: "purchase",
    },
    {
      step: 3,
      title: "Refresh Verification Page",
      description: "Return to the verification page and click 'Run Verification' to view results.",
      testItemId: "purchase",
    },
  ];
  const fullSteps = [
    ...quickSteps,
    {
      step: 4,
      title: "Test Multi-Item Order",
      description: "Add 2-3 different items and complete checkout. Verify item count and total price are correct.",
      testItemId: "purchase_multi",
    },
    {
      step: 5,
      title: "Test Discounted Order",
      description: "Complete an order using a discount code. Verify the discounted amount is correctly passed.",
      testItemId: "purchase_discount",
    },
  ];
  const steps = runType === "full" ? fullSteps : quickSteps;
  return {
    steps,
    estimatedTime: runType === "full" ? "15-20 minutes" : "5-10 minutes",
    tips: [
      "Use a development store or test mode to avoid real charges",
      "Ensure the Web Pixel is installed and complete test order verification",
      "Enable Bogus Gateway or Shopify Payments test mode in your Shopify admin",
      "If using incognito mode, make sure to accept cookies and tracking consent",
    ],
  };
}

import { escapeCSV } from "../utils/csv.server";

export async function exportVerificationReport(
  runId: string,
  format: "json" | "csv" = "json"
): Promise<{ content: string; filename: string; mimeType: string }> {
  const summary = await getVerificationRun(runId);
  if (!summary) {
    throw new Error("Verification run not found");
  }
  const timestamp = new Date().toISOString().split("T")[0];
  const filename = `verification-report-${timestamp}`;
  if (format === "csv") {
    const headers = [
      "Test Item",
      "Event Type",
      "Platform",
      "Order ID",
      "Status",
      "Value",
      "Currency",
      "Issues",
    ];
    const rows = summary.results.map((r) => [
      escapeCSV(r.testItemId),
      escapeCSV(r.eventType),
      escapeCSV(r.platform),
      escapeCSV(r.orderId || ""),
      escapeCSV(r.status),
      escapeCSV(r.params?.value?.toString() || ""),
      escapeCSV(r.params?.currency || ""),
      escapeCSV(r.discrepancies?.join("; ") || r.errors?.join("; ") || ""),
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    return {
      content: csvContent,
      filename: `${filename}.csv`,
      mimeType: "text/csv",
    };
  }
  return {
    content: JSON.stringify(summary, null, 2),
    filename: `${filename}.json`,
    mimeType: "application/json",
  };
}
