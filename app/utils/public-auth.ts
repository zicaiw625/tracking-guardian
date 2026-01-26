import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { logger } from "./logger.server";
import { API_SECURITY_HEADERS, addSecurityHeadersToHeaders } from "./security-headers";
import { getDynamicCorsHeaders } from "./cors";
import { isValidShopifyOrigin } from "./origin-validation.server";
import { SecureShopDomainSchema } from "./security";

export interface PublicAuthResult {
  sessionToken: {
    dest: string;
    sub?: string;
    [key: string]: unknown;
  };
  cors: (response: Response) => Response;
  surface: "checkout" | "customer_account";
}

export async function tryAuthenticatePublicWithShop(
  request: Request
): Promise<{ authResult: PublicAuthResult; shopDomain: string } | null> {
  try {
    const authResult = await authenticatePublic(request);
    const shopDomain = normalizeDestToShopDomain(authResult.sessionToken.dest);
    if (!shopDomain) {
      return null;
    }
    return { authResult, shopDomain };
  } catch {
    return null;
  }
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

export function normalizeDestToShopDomain(dest: string): string | null {
  let host: string;
  try {
    const url = new URL(dest);
    host = url.hostname;
  } catch {
    host = dest.replace(/^https?:\/\//, "").split("/")[0] || "";
  }
  const parsed = SecureShopDomainSchema.safeParse(host);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
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

export function publicJsonWithAuthCors<T>(
  request: Request,
  authResult: PublicAuthResult,
  data: T,
  init?: ResponseInit & { customCorsHeaders?: string[] }
): Response {
  const corsHeaders = init?.customCorsHeaders || ["Authorization"];
  const corsResponse = authResult.cors(new Response(JSON.stringify(data), {
    status: init?.status || 200,
    statusText: init?.statusText,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  }));
  const mergedHeaders = new Headers(corsResponse.headers);
  const dynamicCors = getDynamicCorsHeaders(request, corsHeaders);
  Object.entries(dynamicCors).forEach(([key, value]) => {
    if (value && !mergedHeaders.has(key)) {
      mergedHeaders.set(key, value);
    }
  });
  addSecurityHeadersToHeaders(mergedHeaders, API_SECURITY_HEADERS);
  return new Response(corsResponse.body, {
    status: corsResponse.status,
    statusText: corsResponse.statusText,
    headers: mergedHeaders,
  });
}
