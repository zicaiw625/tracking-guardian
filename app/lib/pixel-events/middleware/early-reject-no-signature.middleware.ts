import { jsonWithCors } from "../cors";
import { rejectionTracker } from "../rejection-tracker.server";
import { shouldRecordRejection } from "../stats-sampling";
import { metrics } from "~/utils/logger.server";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

export const earlyRejectNoSignatureMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (context.isProduction && !context.signature) {
    if (shouldRecordRejection(context.isProduction, true, "signature_missing")) {
      rejectionTracker.record({
        requestId: context.requestId,
        shopDomain: context.shopDomainHeader || "unknown",
        reason: "signature_missing",
        timestamp: Date.now(),
      });
    }
    metrics.pixelRejection({
      requestId: context.requestId,
      shopDomain: context.shopDomainHeader,
      reason: "signature_missing",
    });
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Invalid request" },
        { status: 403, request: context.request, requestId: context.requestId }
      ),
    };
  }
  return { continue: true, context };
};
