import { json } from "@remix-run/node";
import { isValidShopifyOrigin, isValidDevOrigin, isDevMode, extractOriginHost, SHOPIFY_ALLOWLIST, } from "./origin-validation";
export const SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
} as const;
/**
 * 静态 CORS headers，用于 Checkout UI Extension 等场景
 * 
 * 修复说明（P0-2）：
 * - Access-Control-Allow-Methods 必须包含 GET, OPTIONS（因为扩展使用 GET 请求）
 * - Access-Control-Allow-Headers 必须包含 Authorization, Content-Type, X-Shopify-Shop-Domain
 *   因为扩展的 fetch 请求会带这些自定义 headers，触发 CORS 预检
 */
export const STATIC_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Shop-Domain",
    "Access-Control-Max-Age": "86400",
    ...SECURITY_HEADERS,
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
        "X-Tracking-Guardian-Key",
        "X-Tracking-Guardian-Timestamp",
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
        "X-Tracking-Guardian-Key",
        "X-Tracking-Guardian-Timestamp",
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
        const isShopifyPlatform = SHOPIFY_ALLOWLIST.some(domain => originHost === domain || originHost.endsWith(`.${domain}`));
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
    staticCors?: boolean;
    headers?: HeadersInit;
}
export function jsonWithCors<T>(data: T, init?: CorsResponseInit): Response {
    const { request, staticCors, headers: additionalHeaders, ...responseInit } = init || {};
    let corsHeaders: HeadersInit;
    if (staticCors) {
        corsHeaders = STATIC_CORS_HEADERS;
    }
    else if (request) {
        corsHeaders = getDynamicCorsHeaders(request);
    }
    else {
        corsHeaders = SECURITY_HEADERS;
    }
    const mergedHeaders = new Headers(corsHeaders as Record<string, string>);
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
export function handleCorsPreFlight(request?: Request, staticCors = false): Response {
    const headers = staticCors
        ? STATIC_CORS_HEADERS
        : (request ? getDynamicCorsHeaders(request) : SECURITY_HEADERS);
    return new Response(null, {
        status: 204,
        headers,
    });
}

/**
 * 处理 OPTIONS 预检请求（用于 Checkout UI Extension 等场景）
 */
export function optionsResponse(request: Request, staticCors = true): Response {
    return handleCorsPreFlight(request, staticCors);
}
export function addCorsHeaders(response: Response, request?: Request, staticCors = false): Response {
    const headers = staticCors
        ? STATIC_CORS_HEADERS
        : (request ? getDynamicCorsHeaders(request) : SECURITY_HEADERS);
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
