import { authenticate } from "../shopify.server";
import { logger } from "./logger.server";
import { API_SECURITY_HEADERS, addSecurityHeadersToHeaders } from "./security-headers";
import { getDynamicCorsHeaders } from "./cors";
import { isValidShopifyOrigin } from "./origin-validation";

export interface PublicAuthResult {
  sessionToken: {
    dest: string;
    sub?: string;
    [key: string]: unknown;
  };
  cors: (response: Response) => Response;
  surface: "checkout" | "customer_account";
}

export async function authenticatePublic(request: Request): Promise<PublicAuthResult> {
  try {
    const { sessionToken, cors } = await authenticate.public.checkout(request);
    return { sessionToken: sessionToken as unknown as PublicAuthResult["sessionToken"], cors, surface: "checkout" as const };
  } catch {
    try {
      const { sessionToken, cors } = await authenticate.public.customerAccount(request);
      return { sessionToken: sessionToken as unknown as PublicAuthResult["sessionToken"], cors, surface: "customer_account" as const };
    } catch (error) {
      logger.warn("Public extension authentication failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export async function handlePublicPreflight(request: Request): Promise<Response> {
  const corsHeaders = ["Authorization", "Content-Type"];

  try {
    const { cors } = await authenticate.public.checkout(request);
    return cors(new Response(null, { status: 204 }));
  } catch (e) {
    if (e instanceof Response) {
      const headers = getDynamicCorsHeaders(request, corsHeaders);
      const responseHeaders = new Headers(e.headers);
      Object.entries(headers).forEach(([key, value]) => {
        if (value) {
          responseHeaders.set(key, value);
        }
      });
      return new Response(null, {
        status: e.status || 204,
        headers: responseHeaders,
      });
    }
  }

  try {
    const { cors } = await authenticate.public.customerAccount(request);
    return cors(new Response(null, { status: 204 }));
  } catch (e) {
    if (e instanceof Response) {
      const headers = getDynamicCorsHeaders(request, corsHeaders);
      const responseHeaders = new Headers(e.headers);
      Object.entries(headers).forEach(([key, value]) => {
        if (value) {
          responseHeaders.set(key, value);
        }
      });
      return new Response(null, {
        status: e.status || 204,
        headers: responseHeaders,
      });
    }
  }

  const headers = getDynamicCorsHeaders(request, corsHeaders);
  const origin = request.headers.get("Origin");
  const finalHeaders = new Headers(headers);
  if (!finalHeaders.has("Access-Control-Allow-Origin")) {
    if (origin && origin !== "null" && isValidShopifyOrigin(origin)) {
      finalHeaders.set("Access-Control-Allow-Origin", origin);
    } else {
      return new Response(null, {
        status: 403,
        headers: finalHeaders,
      });
    }
  }
  if (!finalHeaders.has("Access-Control-Allow-Methods")) {
    const reqMethod = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
    const allow = new Set(["GET", "POST", "OPTIONS"]);
    if (reqMethod) {
      allow.add(reqMethod);
    }
    finalHeaders.set("Access-Control-Allow-Methods", Array.from(allow).join(", "));
  }
  if (!finalHeaders.has("Access-Control-Allow-Headers")) {
    finalHeaders.set("Access-Control-Allow-Headers", corsHeaders.join(", "));
  }
  return new Response(null, {
    status: 204,
    headers: finalHeaders,
  });
}

export function normalizeDestToShopDomain(dest: string): string {
  try {
    const url = new URL(dest);
    return url.hostname;
  } catch {
    return dest.replace(/^https?:\/\//, "").split("/")[0];
  }
}

export function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  addSecurityHeadersToHeaders(headers, API_SECURITY_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
