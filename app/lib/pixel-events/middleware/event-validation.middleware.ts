import { jsonWithCors } from "../cors";
import { validateRequest } from "../validation";
import { API_CONFIG } from "~/utils/config.server";
import { logger } from "~/utils/logger.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { PixelEventPayload } from "../types";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

const MAX_BATCH_SIZE = 100;
const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;

function toIntegerOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export const eventValidationMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (context.rawEvents.length === 0) {
    if (shouldRecordRejection(context.isProduction, false, "empty_events")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        reason: "empty_events",
        timestamp: Date.now(),
      });
    }
    logger.warn("Empty events array in /ingest", {
      requestId: context.requestId,
      shopDomain: context.shopDomainHeader,
    });
    if (context.isProduction) {
      return {
        continue: false,
        response: jsonWithCors(
          { error: "Invalid request" },
          { status: 400, request: context.request, requestId: context.requestId }
        ),
      };
    }
    return {
      continue: false,
      response: jsonWithCors(
        { error: "events array cannot be empty" },
        { status: 400, request: context.request, requestId: context.requestId }
      ),
    };
  }

  if (context.rawEvents.length > MAX_BATCH_SIZE) {
    if (shouldRecordRejection(context.isProduction, false, "invalid_payload")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        reason: "invalid_payload",
        timestamp: Date.now(),
      });
    }
    logger.warn("Events array exceeds maximum size", {
      requestId: context.requestId,
      shopDomain: context.shopDomainHeader,
      count: context.rawEvents.length,
      maxSize: MAX_BATCH_SIZE,
    });
    if (context.isProduction) {
      return {
        continue: false,
        response: jsonWithCors(
          { error: "Invalid request" },
          { status: 400, request: context.request, requestId: context.requestId }
        ),
      };
    }
    return {
      continue: false,
      response: jsonWithCors(
        { error: `events array exceeds maximum size of ${MAX_BATCH_SIZE}` },
        { status: 400, request: context.request, requestId: context.requestId }
      ),
    };
  }

  const validatedEvents: Array<{ payload: PixelEventPayload; index: number }> = [];
  for (let i = 0; i < context.rawEvents.length; i++) {
    const eventValidation = validateRequest(context.rawEvents[i]);
    if (!eventValidation.valid) {
      if (i === 0) {
        if (shouldRecordRejection(context.isProduction, false, "invalid_payload")) {
          rejectionTracker.record({
            requestId: context.requestId,
            shopDomain: context.shopDomainHeader,
            reason: "invalid_payload",
            timestamp: Date.now(),
          });
        }
        logger.warn("Invalid event in batch", {
          requestId: context.requestId,
          shopDomain: context.shopDomainHeader,
          error: eventValidation.error,
        });
        if (context.isProduction) {
          return {
            continue: false,
            response: jsonWithCors(
              { error: "Invalid request" },
              { status: 400, request: context.request, requestId: context.requestId }
            ),
          };
        }
        return {
          continue: false,
          response: jsonWithCors(
            { error: "Invalid event in batch", details: eventValidation.error },
            { status: 400, request: context.request, requestId: context.requestId }
          ),
        };
      }
      logger.warn(`Invalid event at index ${i} in batch, skipping`, {
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        error: eventValidation.error,
      });
      continue;
    }
    const nowForEvent = Date.now();
    if (Math.abs(nowForEvent - eventValidation.payload.timestamp) > TIMESTAMP_WINDOW_MS) {
      logger.debug(`Event at index ${i} timestamp outside window: diff=${Math.abs(nowForEvent - eventValidation.payload.timestamp)}ms, skipping`, {
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        eventTimestamp: eventValidation.payload.timestamp,
      });
      continue;
    }

    if (!context.batchTimestamp) {
      context.batchTimestamp = eventValidation.payload.timestamp;
    }

    validatedEvents.push({
      payload: eventValidation.payload,
      index: i,
    });
  }

  if (validatedEvents.length === 0) {
    if (shouldRecordRejection(context.isProduction, false, "invalid_payload")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        reason: "invalid_payload",
        timestamp: Date.now(),
      });
    }
    if (context.isProduction) {
      // Short-circuit if no valid events (Fix P1-4)
      return {
        continue: false,
        response: jsonWithCors(
          { error: "Invalid request" },
          { status: 400, request: context.request, requestId: context.requestId }
        ),
      };
    }
    return {
      continue: false,
      response: jsonWithCors(
        { error: "No valid events in batch" },
        { status: 400, request: context.request, requestId: context.requestId }
      ),
    };
  }

  const firstPayload = validatedEvents[0].payload;
  const shopDomain = firstPayload.shopDomain;
  // Fix P0-3: Use header timestamp if available to satisfy HMAC validation, otherwise fall back to payload
  // This ensures top-level array bodies (which lack batch timestamp) validate against the header timestamp
  const headerTimestampVal = context.timestampHeader ? parseInt(context.timestampHeader, 10) : NaN;
  const timestamp = !isNaN(headerTimestampVal) 
    ? headerTimestampVal 
    : (context.batchTimestamp ?? firstPayload.timestamp);

  for (const { payload } of validatedEvents) {
    if (payload.shopDomain !== shopDomain) {
      if (shouldRecordRejection(context.isProduction, false, "shop_domain_mismatch")) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shopDomainHeader,
          reason: "shop_domain_mismatch",
          timestamp: Date.now(),
        });
      }
      logger.warn("Mixed shopDomain in batch", {
        requestId: context.requestId,
        firstShop: shopDomain,
        mixedShop: payload.shopDomain,
      });
      return {
        continue: false,
        response: jsonWithCors(
          { error: context.isProduction ? "Invalid request" : "Mixed shopDomain in batch" },
          { status: 400, request: context.request, requestId: context.requestId }
        ),
      };
    }
  }

  if (context.shopDomainHeader !== "unknown" && context.shopDomainHeader !== shopDomain) {
    if (context.isProduction) {
      if (shouldRecordRejection(context.isProduction, false, "shop_domain_mismatch")) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain,
          reason: "shop_domain_mismatch",
          timestamp: Date.now(),
        });
      }
      logger.warn(`Rejected ingest request: header shop domain does not match payload shop domain`, {
        requestId: context.requestId,
        shopDomain,
        shopDomainHeader: context.shopDomainHeader,
      });
      return {
        continue: false,
        response: jsonWithCors(
          { error: "Invalid request" },
          { status: 403, request: context.request, requestId: context.requestId }
        ),
      };
    } else {
      logger.warn(`Ingest request: header shop domain does not match payload shop domain`, {
        requestId: context.requestId,
        shopDomain,
        shopDomainHeader: context.shopDomainHeader,
      });
    }
  }

  // Batch timestamp check is relaxed or removed in favor of individual event check
  // But we still keep it for logging or rejection if the whole batch is wildly off?
  // User suggestion: "unified standard: filter by single event timestamp".
  // Since we already filtered individually above, validatedEvents only contains valid ones.
  // We can skip this block or make it just a warning.
  // However, for HMAC/replay attack prevention, we might still care about the "request" timestamp.
  // But since HMAC usually signs the body, and the body contains timestamps...
  // Let's rely on the individual filtering we added above. 
  // If all events were skipped, we return early (validatedEvents.length === 0 check above).
  
  /* 
  if (Math.abs(nowForWindow - timestamp) > TIMESTAMP_WINDOW_MS) {
     ...
  }
  */
  
  // We remove the batch-level rejection because we filtered individually.
  // If the batch timestamp (first event) was bad, it was skipped, so 'timestamp' here 
  // would be from the first VALID event (if we update logic to pick it) OR 
  // context.batchTimestamp might still be the first one.
  
  // Actually, 'timestamp' variable is defined as:
  // const timestamp = context.batchTimestamp ?? firstPayload.timestamp;
  // If context.batchTimestamp comes from the first event in RAW array (which we did in the loop), 
  // it might be invalid.
  
  // But we don't want to reject the whole request if one event is old, we just want to process valid ones.
  // So we should remove this block.
  
  const bodyEnvelope = context.bodyData && typeof context.bodyData === "object"
    ? (context.bodyData as Record<string, unknown>)
    : null;
  const bodySignature = typeof bodyEnvelope?.signature === "string" && bodyEnvelope.signature.trim().length > 0
    ? bodyEnvelope.signature.trim()
    : null;
  const bodySignatureTimestamp = toIntegerOrNull(bodyEnvelope?.signatureTimestamp);
  const bodySignatureShopDomain = typeof bodyEnvelope?.signatureShopDomain === "string" && bodyEnvelope.signatureShopDomain.trim().length > 0
    ? bodyEnvelope.signatureShopDomain.trim()
    : null;
  const allowBodySignature = !context.isProduction;
  const resolvedBodySignature = allowBodySignature ? bodySignature : null;
  const resolvedSignature = context.signature ?? resolvedBodySignature;
  const resolvedTimestampHeader = context.timestampHeader ?? (
    allowBodySignature && bodySignatureTimestamp !== null ? String(bodySignatureTimestamp) : null
  );
  const resolvedTimestamp = context.timestamp ?? (allowBodySignature ? bodySignatureTimestamp : null) ?? timestamp;

  return {
    continue: true,
    context: {
      ...context,
      validatedEvents,
      shopDomain,
      timestamp: resolvedTimestamp,
      signature: resolvedSignature,
      timestampHeader: resolvedTimestampHeader,
      bodySignature: resolvedBodySignature,
      hasBodySignature: Boolean(resolvedBodySignature),
      bodySignatureTimestamp,
      bodySignatureShopDomain,
      signatureSource: context.signature ? "header" : resolvedBodySignature ? "body" : "none",
    },
  };
};
