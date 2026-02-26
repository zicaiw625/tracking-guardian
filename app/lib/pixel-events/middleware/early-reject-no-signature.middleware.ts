import { jsonWithCors } from "../cors";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

export const earlyRejectNoSignatureMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (context.isProduction && context.signatureSource === "none") {
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
