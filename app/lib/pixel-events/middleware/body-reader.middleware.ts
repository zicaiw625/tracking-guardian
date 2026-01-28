import { jsonWithCors } from "../cors";
import { readTextWithLimit } from "~/utils/body-reader";
import { API_CONFIG } from "~/utils/config.server";
import { logger } from "~/utils/logger.server";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

function isAcceptableContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return lower.includes("text/plain") || lower.includes("application/json");
}

export const bodyReaderMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  const contentType = context.request.headers.get("Content-Type");
  if (!isAcceptableContentType(contentType)) {
    if (shouldRecordRejection(context.isProduction, false)) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        reason: "content_type_invalid",
        timestamp: Date.now(),
      });
    }
    if (context.isProduction) {
      logger.warn("Invalid Content-Type in /ingest", {
        requestId: context.requestId,
        contentType,
        shopDomain: context.shopDomainHeader,
      });
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
        { error: "Content-Type must be text/plain or application/json" },
        { status: 415, request: context.request, requestId: context.requestId }
      ),
    };
  }

  const contentLength = context.request.headers.get("Content-Length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > API_CONFIG.MAX_BODY_SIZE) {
      if (shouldRecordRejection(context.isProduction, false)) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shopDomainHeader,
          reason: "body_too_large",
          timestamp: Date.now(),
        });
      }
      logger.warn(`Request body too large: ${size} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`, {
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
          { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
          { status: 413, request: context.request, requestId: context.requestId }
        ),
      };
    }
  }

  let bodyText: string;
  let bodyData: unknown;
  try {
    bodyText = await readTextWithLimit(context.request, API_CONFIG.MAX_BODY_SIZE);
    bodyData = JSON.parse(bodyText);
  } catch (error) {
    if (error instanceof Response) {
      if (error.status === 413) {
        if (shouldRecordRejection(context.isProduction, false)) {
          rejectionTracker.record({
            requestId: context.requestId,
            shopDomain: context.shopDomainHeader,
            reason: "body_too_large",
            timestamp: Date.now(),
          });
        }
        logger.warn("Request body too large", {
          requestId: context.requestId,
          shopDomain: context.shopDomainHeader,
          maxSize: API_CONFIG.MAX_BODY_SIZE,
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
            { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
            { status: 413, request: context.request, requestId: context.requestId }
          ),
        };
      }
      if (shouldRecordRejection(context.isProduction, false)) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shopDomainHeader,
          reason: "invalid_payload",
          timestamp: Date.now(),
        });
      }
      logger.warn("Failed to read request body", {
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        error: error instanceof Error ? error.message : String(error),
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
          { error: "Failed to read request body" },
          { status: 400, request: context.request, requestId: context.requestId }
        ),
      };
    }
    if (error instanceof SyntaxError) {
      if (shouldRecordRejection(context.isProduction, false)) {
        rejectionTracker.record({
          requestId: context.requestId,
          shopDomain: context.shopDomainHeader,
          reason: "invalid_json",
          timestamp: Date.now(),
        });
      }
      logger.warn("Invalid JSON body in /ingest", {
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        error: error.message,
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
          { error: "Invalid JSON body" },
          { status: 400, request: context.request, requestId: context.requestId }
        ),
      };
    }
    if (shouldRecordRejection(context.isProduction, false)) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader,
        reason: "invalid_payload",
        timestamp: Date.now(),
      });
    }
    logger.warn("Failed to read request body", {
      requestId: context.requestId,
      shopDomain: context.shopDomainHeader,
      error: error instanceof Error ? error.message : String(error),
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
        { error: "Failed to read request body" },
        { status: 400, request: context.request, requestId: context.requestId }
      ),
    };
  }

  const isBatchFormat =
    typeof bodyData === "object" &&
    bodyData !== null &&
    "events" in bodyData &&
    Array.isArray((bodyData as { events?: unknown }).events);

  let rawEvents: unknown[];
  let batchTimestamp: number | undefined;
  if (isBatchFormat) {
    const batchData = bodyData as { events: unknown[]; timestamp?: number };
    rawEvents = batchData.events || [];
    batchTimestamp = batchData.timestamp;
  } else {
    rawEvents = [bodyData];
  }

  return {
    continue: true,
    context: {
      ...context,
      bodyText,
      bodyData,
      rawEvents,
      batchTimestamp,
    },
  };
};
