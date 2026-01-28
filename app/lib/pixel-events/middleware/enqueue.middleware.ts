import { jsonWithCors } from "../cors";
import { enqueueIngestBatch } from "../ingest-queue.server";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

export const enqueueMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (!context.shop || !context.shopDomain) {
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Invalid request" },
        { status: 500, request: context.request, requestId: context.requestId }
      ),
    };
  }


  const entry = {
    requestId: context.requestId,
    shopId: context.shop.id,
    shopDomain: context.shopDomain,
    environment: context.environment,
    mode: context.mode,
    validatedEvents: context.validatedEvents,
    keyValidation: context.keyValidation,
    origin: context.origin,
    enabledPixelConfigs: context.enabledPixelConfigs.map((c) => ({
      platform: (c as { platform?: string }).platform ?? "",
      id: (c as { id?: string }).id ?? "",
      platformId: (c as { platformId?: string | null }).platformId ?? null,
      clientSideEnabled: (c as { clientSideEnabled?: boolean | null }).clientSideEnabled ?? null,
      clientConfig: (c as { clientConfig?: unknown }).clientConfig ?? null,
    })),
  };

  const ok = await enqueueIngestBatch(entry);
  if (!ok) {
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Failed to enqueue events", accepted_count: 0 },
        { status: 503, request: context.request, requestId: context.requestId }
      ),
    };
  }

  return {
    continue: false,
    response: jsonWithCors(
      { accepted_count: context.validatedEvents.length, errors: [] },
      { status: 202, request: context.request, requestId: context.requestId }
    ),
  };
};
