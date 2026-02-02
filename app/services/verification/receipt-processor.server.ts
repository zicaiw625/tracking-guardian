import { EventType, Platform } from "~/utils/constants";
import type { VerificationEventResult } from "../verification.server";
import { parseEventPayload } from "./payload-parser.server";
import { extractPlatformFromPayload } from "~/utils/common";

export interface ReceiptProcessingResult {
  result: VerificationEventResult;
  stats: {
    passed: boolean;
    missingParams: boolean;
    failed: boolean;
    valueMatched: boolean;
    currencyMatched: boolean;
  };
  consistencyIssues: Array<{
    orderId: string;
    issue: string;
    type: "value_mismatch" | "currency_mismatch";
  }>;
}

export function processReceipt(
  receipt: {
    id: string;
    eventType: string;
    platform: string | null;
    payloadJson: any;
    pixelTimestamp: Date;
    createdAt: Date;
    orderKey: string | null;
  },
  orderSummary: { totalPrice: number; currency: string } | undefined,
  dedupInfo: { existingEventId?: string; reason?: string } | undefined,
  targetPlatforms: string[]
): ReceiptProcessingResult | null {
  const payload = receipt.payloadJson as Record<string, unknown> | null;
  const platform = receipt.platform ?? extractPlatformFromPayload(payload);

  if (!platform || (targetPlatforms.length > 0 && !targetPlatforms.includes(platform))) {
    return null;
  }

  const parsed = parseEventPayload(platform, payload);
  const orderId = receipt.orderKey || (parsed.raw?.orderId as string);

  const hasValue = parsed.value !== undefined && parsed.value !== null;
  const hasCurrency = !!parsed.currency;
  const hasEventId = !!payload?.eventId || !!receipt.id;
  const p = platform || Platform.UNKNOWN;

  const stats = {
    passed: false,
    missingParams: false,
    failed: false,
    valueMatched: false,
    currencyMatched: false,
  };
  const consistencyIssues: ReceiptProcessingResult["consistencyIssues"] = [];

  // 1. Non-Purchase Events
  if (receipt.eventType !== EventType.PURCHASE) {
    const hasBasicFields = !!(payload?.eventId ?? receipt.id) && !!(payload?.eventName ?? receipt.eventType);
    
    if (hasBasicFields) {
      stats.passed = true;
      return {
        result: {
          testItemId: receipt.eventType,
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          status: "success",
          triggeredAt: receipt.pixelTimestamp,
          params: { hasEventId },
        },
        stats,
        consistencyIssues,
      };
    } else {
      stats.missingParams = true;
      stats.failed = true;
      const disc: string[] = [];
      if (!(payload?.eventId ?? receipt.id)) disc.push("缺少 eventId");
      if (!(payload?.eventName ?? receipt.eventType)) disc.push("缺少 eventName");
      
      return {
        result: {
          testItemId: receipt.eventType,
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          status: "missing_params",
          triggeredAt: receipt.pixelTimestamp,
          params: { hasEventId },
          discrepancies: disc.length > 0 ? disc : undefined,
        },
        stats,
        consistencyIssues,
      };
    }
  }

  // 2. Purchase Events
  if (hasValue && hasCurrency) {
    if (dedupInfo) {
      return {
        result: {
          testItemId: EventType.PURCHASE,
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          status: "deduplicated",
          triggeredAt: receipt.pixelTimestamp,
          params: {
            value: parsed.value,
            currency: parsed.currency,
            items: parsed.itemCount,
            hasEventId,
          },
          dedupInfo,
        },
        stats, // No stats update for duplicates? Original code didn't count them as passed/failed
        consistencyIssues,
      };
    } else {
      stats.passed = true;
      
      if (orderSummary) {
        const valueMatch = Math.abs((parsed.value ?? 0) - orderSummary.totalPrice) < 0.01;
        const currencyMatch = (parsed.currency ?? "").toUpperCase() === (orderSummary.currency ?? "").toUpperCase();
        
        if (valueMatch && currencyMatch) {
            stats.valueMatched = true;
            stats.currencyMatched = true;
        } else {
          if (!valueMatch && orderId) {
            consistencyIssues.push({
              orderId,
              issue: `payload value ${parsed.value} vs order total ${orderSummary.totalPrice}`,
              type: "value_mismatch",
            });
          }
          if (!currencyMatch && orderId) {
            consistencyIssues.push({
              orderId,
              issue: `payload currency ${parsed.currency} vs order currency ${orderSummary.currency}`,
              type: "currency_mismatch",
            });
          }
        }
      } else {
        // If no order summary found, we assume value is accurate for the sake of the test (or we can't verify)
        // Original code: totalValueAccuracy += 100;
        stats.valueMatched = true;
        stats.currencyMatched = true;
      }

      return {
        result: {
          testItemId: EventType.PURCHASE,
          eventType: receipt.eventType,
          platform: p,
          orderId: orderId || undefined,
          status: "success",
          triggeredAt: receipt.pixelTimestamp,
          params: {
            value: parsed.value,
            currency: parsed.currency,
            items: parsed.itemCount,
            hasEventId,
          },
        },
        stats,
        consistencyIssues,
      };
    }
  } else {
    stats.missingParams = true;
    stats.failed = true;
    const discrepancies: string[] = [];
    if (!hasValue) discrepancies.push("缺少 value 参数");
    if (!hasCurrency) discrepancies.push("缺少 currency 参数");
    
    return {
      result: {
        testItemId: EventType.PURCHASE,
        eventType: receipt.eventType,
        platform: p,
        orderId: orderId || undefined,
        status: "missing_params",
        triggeredAt: receipt.pixelTimestamp,
        params: {
            value: parsed.value,
            currency: parsed.currency,
            items: parsed.itemCount,
            hasEventId,
        },
        discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
      },
      stats,
      consistencyIssues,
    };
  }
}
