import { jsonWithCors } from "../cors";
import { metrics } from "~/utils/logger.server";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

export const earlyRejectNoSignatureMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (context.isProduction && !context.signature) {
    metrics.pixelRejection({
      requestId: context.requestId,
      shopDomain: context.shopDomainHeader,
      reason: "invalid_key",
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
