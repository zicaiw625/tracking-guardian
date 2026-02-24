import { jsonWithCors } from "../cors";
import { enqueueIngestBatch } from "../ingest-queue.server";
import { ipKeyExtractor } from "~/middleware/rate-limit.server";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

function clampString(s: string | null | undefined, max: number): string | null {
  if (typeof s !== "string") return null;
  return s.replace(/\0/g, "").slice(0, max);
}

function sanitizeUrl(urlStr: string | null): string | null {
  if (!urlStr) return null;
  try {
    const url = new URL(urlStr);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return null;
  }
}

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


  const firstPayload = context.validatedEvents[0]?.payload;
  const pageUrlRaw = typeof firstPayload?.data?.url === "string" ? firstPayload.data.url : null;
  const requestContext = {
    // Keep raw IP for queue/distribution (S2S requirements), will be handled/hashed at storage time if needed
    ip: ipKeyExtractor(context.request), 
    user_agent: clampString(context.request.headers.get("user-agent"), 512),
    page_url: sanitizeUrl(pageUrlRaw),
    referrer: null as string | null,
  };
  const entry = {
    requestId: context.requestId,
    shopId: context.shop.id,
    shopDomain: context.shopDomain,
    environment: context.environment,
    mode: context.mode,
    validatedEvents: context.validatedEvents,
    keyValidation: context.keyValidation,
    origin: context.origin,
    requestContext,
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
