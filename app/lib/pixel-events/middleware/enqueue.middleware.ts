import { jsonWithCors } from "../cors";
import { enqueueIngestBatch } from "../ingest-queue.server";
import { ipKeyExtractor } from "~/middleware/rate-limit.server";
import { encrypt } from "~/utils/crypto.server";
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
  const shouldIncludeSensitiveContext = process.env.SERVER_SIDE_CONVERSIONS_ENABLED === "true";
  const rawIp = shouldIncludeSensitiveContext ? ipKeyExtractor(context.request) : null;
  const rawUserAgent = shouldIncludeSensitiveContext ? clampString(context.request.headers.get("user-agent"), 512) : null;
  const requestContext = {
    ip_encrypted: rawIp ? encrypt(rawIp) : null,
    user_agent_encrypted: rawUserAgent ? encrypt(rawUserAgent) : null,
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

  const enqueueResult = await enqueueIngestBatch(entry);
  if (!enqueueResult.ok) {
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Failed to enqueue events", accepted_count: 0 },
        { status: 503, request: context.request, requestId: context.requestId }
      ),
    };
  }

  const dropped = enqueueResult.dropped || 0;
  return {
    continue: false,
    response: jsonWithCors(
      {
        accepted_count: context.validatedEvents.length,
        errors: dropped > 0 ? [`Queue backpressure dropped ${dropped} older batch(es)`] : [],
        warnings: dropped > 0 ? ["queue_backpressure_drop"] : [],
      },
      { status: 202, request: context.request, requestId: context.requestId }
    ),
  };
};
