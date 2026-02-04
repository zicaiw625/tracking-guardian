import { jsonWithCors } from "../cors";
import { enqueueIngestBatch } from "../ingest-queue.server";
import { ipKeyExtractor } from "~/middleware/rate-limit.server";
import { createHash } from "crypto";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

function clampString(s: string | null | undefined, max: number): string | null {
  if (typeof s !== "string") return null;
  return s.replace(/\0/g, "").slice(0, max);
}

function anonymizeIp(ip: string | null): string | null {
  if (!ip) return null;
  // Use a salt to prevent rainbow table attacks, defaulting if not set
  const salt = process.env.ENCRYPTION_SALT || "tracking-guardian-ip-salt";
  return createHash("sha256").update(ip + salt).digest("hex").substring(0, 32);
}

function sanitizeUrl(urlStr: string | null): string | null {
  if (!urlStr) return null;
  try {
    const url = new URL(urlStr);
    // Only keep protocol, hostname, and path. Remove search/hash to strip PII.
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    // If invalid URL, return clamped raw string or null? 
    // Return clamped raw string but truncated to avoid issues, or just null.
    // Review suggests "hostname + path", so if we can't parse, it's safer to drop or return minimal.
    return clampString(urlStr, 100); 
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
    ip: anonymizeIp(ipKeyExtractor(context.request)),
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
