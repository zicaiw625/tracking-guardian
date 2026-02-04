import { jsonWithCors, emptyResponseWithCors } from "../cors";
import { validateRequest } from "../validation";
import { API_CONFIG } from "~/utils/config.server";
import { logger } from "~/utils/logger.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { PixelEventPayload } from "../types";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

const MAX_BATCH_SIZE = 100;
const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;

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
    validatedEvents.push({
      payload: eventValidation.payload,
      index: i,
    });
    if (i === 0 && !context.batchTimestamp) {
      context.batchTimestamp = eventValidation.payload.timestamp;
    }
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
  const timestamp = context.batchTimestamp ?? firstPayload.timestamp;

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

  const nowForWindow = Date.now();
  if (Math.abs(nowForWindow - timestamp) > TIMESTAMP_WINDOW_MS) {
    if (shouldRecordRejection(context.isProduction, false, "invalid_timestamp")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain,
        reason: "invalid_timestamp",
        timestamp: Date.now(),
      });
    }
    logger.debug(
      `Payload timestamp outside window: diff=${Math.abs(nowForWindow - timestamp)}ms, dropping request`,
      { requestId: context.requestId, shopDomain }
    );
    return {
      continue: false,
      response: emptyResponseWithCors(context.request, undefined, context.requestId),
    };
  }

  return {
    continue: true,
    context: {
      ...context,
      validatedEvents,
      shopDomain,
      timestamp,
    },
  };
};
