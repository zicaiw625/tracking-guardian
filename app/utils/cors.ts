import { json } from "@remix-run/node";
import { isValidShopifyOrigin, isValidDevOrigin, isDevMode, extractOriginHost, SHOPIFY_PLATFORM_HOSTS, shouldAllowNullOrigin, } from "./origin-validation.server";
import { API_SECURITY_HEADERS } from "./security-headers";

export const SECURITY_HEADERS = API_SECURITY_HEADERS;

export function getPixelEventsCorsHeaders(request: Request, options?: {
    customHeaders?: string[];
    originValidation?: {
        valid: boolean;
        reason: string;
    };
}): HeadersInit {
    const origin = request.headers.get("Origin");
    const hasSignatureHeader = !!request.headers.get("X-Tracking-Guardian-Signature");
    const accessControlRequestHeaders = request.headers.get("Access-Control-Request-Headers") || "";
    const preflightDeclaresSignatureHeader = accessControlRequestHeaders
        .toLowerCase()
        .includes("x-tracking-guardian-signature");
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
    if (request.method.toUpperCase() === "OPTIONS" && isDevMode()) {
        return {
            ...baseHeaders,
            "Access-Control-Allow-Origin": "*",
        };
    }
    if (origin === "null" || origin === null || !origin) {
        if (isDevMode()) {
            return {
                ...baseHeaders,
                "Access-Control-Allow-Origin": "*",
            };
        }
        if (!shouldAllowNullOrigin()) {
            return baseHeaders;
        }
        const allowedBySignature = hasSignatureHeader || preflightDeclaresSignatureHeader;
        if (!allowedBySignature) {
            return baseHeaders;
        }
        return {
            ...baseHeaders,
            "Access-Control-Allow-Origin": "null",
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
    const hasSignatureHeader = !!request.headers.get("X-Tracking-Guardian-Signature");
    const accessControlRequestHeaders = request.headers.get("Access-Control-Request-Headers") || "";
    const preflightDeclaresSignatureHeader = accessControlRequestHeaders
        .toLowerCase()
        .includes("x-tracking-guardian-signature");
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
    if (request.method.toUpperCase() === "OPTIONS" && isDevMode()) {
        return {
            ...baseHeaders,
            "Access-Control-Allow-Origin": "*",
        };
    }
    if (origin === "null" || origin === null || !origin) {
        if (isDevMode()) {
            return {
                ...baseHeaders,
                "Access-Control-Allow-Origin": "*",
            };
        }
        if (!shouldAllowNullOrigin()) {
            return baseHeaders;
        }
        const allowedBySignature = hasSignatureHeader || preflightDeclaresSignatureHeader;
        if (!allowedBySignature) {
            return baseHeaders;
        }
        return {
            ...baseHeaders,
            "Access-Control-Allow-Origin": "null",
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
    const methods = new Set<string>(["OPTIONS"]);
    const requestMethod = request.method?.toUpperCase();
    if (requestMethod && requestMethod !== "OPTIONS") {
        methods.add(requestMethod);
    }
    const preflightMethod = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
    if (preflightMethod) {
        methods.add(preflightMethod);
    }
    const allowedMethods = Array.from(methods).join(", ");
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
            "Access-Control-Allow-Methods": allowedMethods,
            "Access-Control-Allow-Headers": allowedHeaders,
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin",
        };
    }
    if (isDevMode() && isValidDevOrigin(origin)) {
        return {
            ...baseSecurityHeaders,
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": allowedMethods,
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
