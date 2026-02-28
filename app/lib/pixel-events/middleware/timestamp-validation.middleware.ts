import { emptyResponseWithCors, jsonWithCors } from "../cors";
import { API_CONFIG } from "~/utils/config.server";
import { trackAnomaly } from "~/middleware/rate-limit.server";
import { logger, metrics } from "~/utils/logger.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;

export const timestampValidationMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (context.isProduction && context.hasSignatureHeader && !context.timestampHeader) {
    const anomalyCheck = trackAnomaly(context.shopDomainHeader, "invalid_timestamp");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Anomaly threshold reached for ${context.shopDomainHeader}: ${anomalyCheck.reason}`);
    }
    if (shouldRecordRejection(context.isProduction, anomalyCheck.shouldBlock, "timestamp_missing")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        reason: "timestamp_missing",
        timestamp: Date.now(),
      });
    }
    metrics.pixelRejection({
      requestId: context.requestId,
      shopDomain: context.shopDomainHeader,
      reason: "timestamp_missing",
    });
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Missing timestamp header" },
        { status: 403, request: context.request, requestId: context.requestId }
      ),
    };
  }

  if (context.timestampHeader) {
    const timestamp = parseInt(context.timestampHeader, 10);
    if (isNaN(timestamp)) {
      const anomalyCheck = trackAnomaly(context.shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Anomaly threshold reached for ${context.shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      if (shouldRecordRejection(context.isProduction, anomalyCheck.shouldBlock, "invalid_timestamp")) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shopDomainHeader,
          reason: "invalid_timestamp",
          timestamp: Date.now(),
        });
      }
      logger.debug("Invalid timestamp format in header, dropping request", { requestId: context.requestId });
      return {
        continue: false,
        response: emptyResponseWithCors(context.request, undefined, context.requestId),
      };
    }
    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > TIMESTAMP_WINDOW_MS) {
      const anomalyCheck = trackAnomaly(context.shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Anomaly threshold reached for ${context.shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      if (shouldRecordRejection(context.isProduction, anomalyCheck.shouldBlock, "invalid_timestamp")) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shopDomainHeader,
          reason: "invalid_timestamp",
          timestamp: Date.now(),
        });
      }
      logger.debug(`Timestamp outside window: diff=${timeDiff}ms, dropping request`, { requestId: context.requestId });
      return {
        continue: false,
        response: emptyResponseWithCors(context.request, undefined, context.requestId),
      };
    }
  }

  return { continue: true, context };
};
