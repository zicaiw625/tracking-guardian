import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { logger } from "../utils/logger.server";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { checkRateLimitAsync, ipKeyExtractor } from "../middleware/rate-limit.server";

const publicJson = (data: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  addSecurityHeadersToHeaders(headers, PUBLIC_PAGE_HEADERS);
  return json(data, { ...init, headers });
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const ipKey = ipKeyExtractor(request);
    const rateLimitResult = await checkRateLimitAsync(ipKey, 60, 60 * 1000);
    if (!rateLimitResult.allowed) {
      return publicJson(
        {
          error: "Too many requests",
          report: null,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfter || 60),
            "X-RateLimit-Limit": "60",
            "X-RateLimit-Remaining": String(rateLimitResult.remaining || 0),
            "X-RateLimit-Reset": String(Math.ceil((rateLimitResult.resetAt || Date.now()) / 1000)),
          },
        }
      );
    }
    const reportId = params.reportId;
    if (!reportId) {
      return publicJson({ error: "Missing reportId", report: null }, { status: 400 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (token) {
      const targetPath = `/share/scan/${encodeURIComponent(reportId)}/${encodeURIComponent(token)}`;
      const headers = new Headers({ Location: targetPath });
      addSecurityHeadersToHeaders(headers, PUBLIC_PAGE_HEADERS);
      return redirect(targetPath, { headers });
    }

    if (!token) {
      return publicJson({ error: "Missing share token", report: null }, { status: 403 });
    }
  } catch (error) {
    logger.error("Failed to process share scan redirect", {
      error,
      reportId: params.reportId,
    });
    return publicJson(
      { error: error instanceof Error ? error.message : "Failed to process request", report: null },
      { status: 500 }
    );
  }
};
