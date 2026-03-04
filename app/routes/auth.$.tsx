import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const authResult = await authenticate.admin(request);

    // In new embedded auth flows, /auth/session-token may return a Response
    // (for example a redirect back to `shopify-reload`). Preserve it.
    if (authResult instanceof Response) {
        return authResult;
    }

    const currentUrl = new URL(request.url);
    const shopifyReload = currentUrl.searchParams.get("shopify-reload");

    // Fallback for auth flows where session-token auth returns context but
    // the browser still needs to continue to the requested app path.
    if (shopifyReload) {
        try {
            const targetUrl = new URL(shopifyReload, currentUrl.origin);
            if (targetUrl.origin === currentUrl.origin) {
                return redirect(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
            }
        } catch {
            // Ignore malformed shopify-reload values and fall through.
        }
    }

    return null;
};
