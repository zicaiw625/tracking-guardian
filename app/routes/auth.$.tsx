import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const currentUrl = new URL(request.url);
    const shopifyReload = currentUrl.searchParams.get("shopify-reload");
    const chargeId = currentUrl.searchParams.get("charge_id");
    const host = currentUrl.searchParams.get("host");
    const shop = currentUrl.searchParams.get("shop");

    // Prefer explicit bounce-back target first. This prevents the auth/session-token
    // endpoint from becoming a blank terminal page when Shopify navigates top-level.
    if (shopifyReload) {
        try {
            const targetUrl = new URL(shopifyReload, currentUrl.origin);
            if (targetUrl.origin === currentUrl.origin) {
                if (chargeId && !targetUrl.searchParams.has("charge_id")) {
                    targetUrl.searchParams.set("charge_id", chargeId);
                }
                if (host && !targetUrl.searchParams.has("host")) {
                    targetUrl.searchParams.set("host", host);
                }
                if (shop && !targetUrl.searchParams.has("shop")) {
                    targetUrl.searchParams.set("shop", shop);
                }
                return redirect(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
            }
        } catch {
            // Ignore malformed shopify-reload values and continue auth fallback.
        }
    }

    const authResult = await authenticate.admin(request);

    // In new embedded auth flows, /auth/session-token may return a Response
    // (for example a redirect back to `shopify-reload`). Preserve it.
    if (authResult instanceof Response) {
        return authResult;
    }

    // Secondary fallback for auth flows where session-token auth returns context
    // and browser still needs to continue to requested app path.
    if (shopifyReload) {
        try {
            const targetUrl = new URL(shopifyReload, currentUrl.origin);
            if (targetUrl.origin === currentUrl.origin) {
                if (chargeId && !targetUrl.searchParams.has("charge_id")) {
                    targetUrl.searchParams.set("charge_id", chargeId);
                }
                if (host && !targetUrl.searchParams.has("host")) {
                    targetUrl.searchParams.set("host", host);
                }
                if (shop && !targetUrl.searchParams.has("shop")) {
                    targetUrl.searchParams.set("shop", shop);
                }
                return redirect(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
            }
        } catch {
            // Ignore malformed shopify-reload values and fall through.
        }
    }

    return null;
};
