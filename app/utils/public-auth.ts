import { authenticate } from "../shopify.server";
import { logger } from "./logger.server";

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
    return { sessionToken, cors, surface: "checkout" as const };
  } catch {
    try {
      const { sessionToken, cors } = await authenticate.public.customerAccount(request);
      return { sessionToken, cors, surface: "customer_account" as const };
    } catch (error) {
      logger.warn("Public extension authentication failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export async function handlePublicPreflight(request: Request): Promise<Response> {
  let checkoutCors: ((response: Response, options?: { corsHeaders?: string[] }) => Response) | null = null;
  let customerAccountCors: ((response: Response, options?: { corsHeaders?: string[] }) => Response) | null = null;

  try {
    const result = await authenticate.public.checkout(request);
    checkoutCors = result.cors;
  } catch (e) {
    if (e instanceof Response) {
    } else {
      logger.debug("Checkout surface preflight failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    const result = await authenticate.public.customerAccount(request);
    customerAccountCors = result.cors;
  } catch (e) {
    if (e instanceof Response) {
    } else {
      logger.debug("Customer account surface preflight failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const cors = checkoutCors || customerAccountCors;
  if (cors) {
    return cors(new Response(null, { status: 204 }), {
      corsHeaders: ["Authorization"],
    });
  }

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers });
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
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
