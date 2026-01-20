import { json } from "@remix-run/node";
import { isValidShopifyOrigin, isValidDevOrigin, isDevMode, extractOriginHost, SHOPIFY_PLATFORM_HOSTS, shouldAllowNullOrigin, } from "./origin-validation";

export const SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

export function getPixelEventsCorsHeaders(request: Request, options?: {
    customHeaders?: string[];
    originValidation?: {
        valid: boolean;
        reason: string;
    };
}): HeadersInit {
    const origin = request.headers.get("Origin");
    const allowedHeaders = [
        "Content-Type",
        "X-Tracking-Guardian-Timestamp",
        "X-Tracking-Guardian-Signature",
        ...(options?.customHeaders || []),
    ].join(", ");
    const baseHeaders = {
        ...SECURITY_HEADERS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": allowedHeaders,
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
    if (origin === "null" || origin === null || !origin) {
        if (!isDevMode() && !shouldAllowNullOrigin()) {
            return baseHeaders;
        }
        return {
            ...baseHeaders,
            "Access-Control-Allow-Origin": "*",
        };
    }
    if (options?.originValidation) {
        if (options.originValidation.valid) {
            return {
                ...baseHeaders,
                "Access-Control-Allow-Origin": origin,
            };
        }
        else {
            return baseHeaders;
        }
    }
    if (isValidShopifyOrigin(origin)) {
        return {
            ...baseHeaders,
            "Access-Control-Allow-Origin": origin,
        };
    }
    if (isDevMode() && isValidDevOrigin(origin)) {
        return {
            ...baseHeaders,
            "Access-Control-Allow-Origin": origin,
        };
    }
    return baseHeaders;
}
export function getPixelEventsCorsHeadersForShop(request: Request, shopAllowedDomains: string[], customHeaders?: string[]): HeadersInit {
    const origin = request.headers.get("Origin");
    const allowedHeaders = [
        "Content-Type",
        "X-Tracking-Guardian-Timestamp",
        "X-Tracking-Guardian-Signature",
        ...(customHeaders || []),
    ].join(", ");
    const baseHeaders = {
        ...SECURITY_HEADERS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": allowedHeaders,
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
    if (origin === "null" || origin === null || !origin) {
        if (!isDevMode() && !shouldAllowNullOrigin()) {
            return baseHeaders;
        }
        return {
            ...baseHeaders,
            "Access-Control-Allow-Origin": "*",
        };
    }
    const originHost = extractOriginHost(origin);
    if (originHost) {
        const isAllowed = shopAllowedDomains.some(domain => {
            const normalizedDomain = domain.toLowerCase();
            return originHost === normalizedDomain || originHost.endsWith(`.${normalizedDomain}`);
        });
        if (isAllowed) {
            return {
                ...baseHeaders,
                "Access-Control-Allow-Origin": origin,
            };
        }
    }
    if (originHost) {
        const isShopifyPlatform = SHOPIFY_PLATFORM_HOSTS.some(domain => originHost === domain || originHost.endsWith(`.${domain}`));
        if (isShopifyPlatform) {
            return {
                ...baseHeaders,
                "Access-Control-Allow-Origin": origin,
            };
        }
    }
    if (isDevMode() && isValidDevOrigin(origin)) {
        return {
            ...baseHeaders,
            "Access-Control-Allow-Origin": origin,
        };
    }
    return baseHeaders;
}
export function getDynamicCorsHeaders(request: Request, customHeaders?: string[]): HeadersInit {
    const origin = request.headers.get("Origin");
    const allowedHeaders = [
        "Content-Type",
        ...(customHeaders || []),
    ].join(", ");
    const baseSecurityHeaders = { ...SECURITY_HEADERS };
    if (origin === "null") {
        return {
            ...baseSecurityHeaders,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": allowedHeaders,
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin",
        };
    }
    if (!origin) {
        return {
            ...baseSecurityHeaders,
            "Vary": "Origin",
        };
    }
    if (isValidShopifyOrigin(origin)) {
        return {
            ...baseSecurityHeaders,
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": allowedHeaders,
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin",
        };
    }
    if (isDevMode() && isValidDevOrigin(origin)) {
        return {
            ...baseSecurityHeaders,
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": allowedHeaders,
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin",
        };
    }
    return {
        ...baseSecurityHeaders,
        "Vary": "Origin",
    };
}
export interface CorsResponseInit extends Omit<ResponseInit, "headers"> {
    request?: Request;
    headers?: HeadersInit;
}
export function jsonWithCors<T>(data: T, init?: CorsResponseInit): Response {
    const { request, headers: additionalHeaders, ...responseInit } = init || {};
    const corsHeaders: HeadersInit = request ? getDynamicCorsHeaders(request) : SECURITY_HEADERS;
    const mergedHeaders = new Headers(corsHeaders as Record<string, string>);
    if (!mergedHeaders.has("Cache-Control")) {
        mergedHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        mergedHeaders.set("Pragma", "no-cache");
        mergedHeaders.set("Expires", "0");
    }
    if (additionalHeaders) {
        const headersToAdd = additionalHeaders instanceof Headers
            ? additionalHeaders
            : new Headers(additionalHeaders as Record<string, string>);
        headersToAdd.forEach((value, key) => {
            mergedHeaders.set(key, value);
        });
    }
    return json(data, {
        ...responseInit,
        headers: mergedHeaders,
    });
}
export function handleCorsPreFlight(request?: Request): Response {
    const headers = request ? getDynamicCorsHeaders(request) : SECURITY_HEADERS;
    return new Response(null, {
        status: 204,
        headers,
    });
}

export function optionsResponse(request: Request): Response {
    return handleCorsPreFlight(request);
}
export function addCorsHeaders(response: Response, request?: Request): Response {
    const headers = request ? getDynamicCorsHeaders(request) : SECURITY_HEADERS;
    const newHeaders = new Headers(response.headers);
    Object.entries(headers).forEach(([key, value]) => {
        newHeaders.set(key, value);
    });
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}
