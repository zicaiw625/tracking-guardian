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
  try {
    await authenticate.public.checkout(request);
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) {
      return e;
    }
  }

  try {
    await authenticate.public.customerAccount(request);
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) {
      return e;
    }
  }

  return new Response(null, { status: 204 });
}

export function normalizeDestToShopDomain(dest: string): string {
  try {
    const url = new URL(dest);
    return url.hostname;
  } catch {
    return dest.replace(/^https?:\/\//, "").split("/")[0];
  }
}
