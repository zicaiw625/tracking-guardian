import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

function getAllowedReloadOrigins(currentUrl: URL): Set<string> {
    const allowedOrigins = new Set<string>([currentUrl.origin]);
    const appUrl = process.env.SHOPIFY_APP_URL?.trim();
    if (appUrl) {
        try {
            allowedOrigins.add(new URL(appUrl).origin);
        } catch {
            // Ignore invalid app url in runtime fallback path.
        }
    }
    return allowedOrigins;
}

function buildSafeReloadTarget(currentUrl: URL, shopifyReload: string): URL | null {
    try {
        const targetUrl = new URL(shopifyReload, currentUrl.origin);
        const allowedOrigins = getAllowedReloadOrigins(currentUrl);
        if (!allowedOrigins.has(targetUrl.origin)) {
            return null;
        }
        return targetUrl;
    } catch {
        return null;
    }
}

function appendMissingAuthParams(source: URL, target: URL): void {
    for (const key of ["charge_id", "host", "shop"]) {
        const value = source.searchParams.get(key);
        if (value && !target.searchParams.has(key)) {
            target.searchParams.set(key, value);
        }
    }
}

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
        const targetUrl = buildSafeReloadTarget(currentUrl, shopifyReload);
        if (targetUrl) {
            appendMissingAuthParams(currentUrl, targetUrl);
            return redirect(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
        }
    }

    return null;
};
