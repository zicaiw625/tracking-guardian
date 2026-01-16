import { logger } from "./logger.server";
export const SHOPIFY_ALLOWLIST = [
    "checkout.shopify.com",
    "shopify.com",
    "myshopify.com",
    "shopifypreview.com",
] as const;

function shouldAllowNullOrigin(): boolean {
    const v = process.env.PIXEL_ALLOW_NULL_ORIGIN?.toLowerCase().trim();
    if (v === "false" || v === "0") return false;
    if (v === "true" || v === "1") return true;

    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv === "development" || nodeEnv === "test") return true;

    return false;
}
const ALLOWED_ORIGIN_PATTERNS: Array<{
    pattern: RegExp;
    description: string;
    example: string;
}> = [
    {
        pattern: /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/,
        description: "Shopify store domains",
        example: "https://example.myshopify.com",
    },
    {
        pattern: /^https:\/\/checkout\.shopify\.com$/,
        description: "Shopify checkout domain",
        example: "https://checkout.shopify.com",
    },
    {
        pattern: /^https:\/\/[a-zA-Z0-9-]+\.shopify\.com$/,
        description: "Shopify internal domains",
        example: "https://admin.shopify.com",
    },
];
const DEV_ORIGIN_PATTERNS: Array<{
    pattern: RegExp;
    description: string;
}> = [
    {
        pattern: /^https?:\/\/localhost(:\d+)?$/,
        description: "Local development server",
    },
    {
        pattern: /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
        description: "Local IP development server",
    },
];
interface RejectedOriginTracker {
    count: number;
    firstSeen: number;
    lastSeen: number;
}
const rejectedOrigins = new Map<string, RejectedOriginTracker>();
const TRACKING_WINDOW_MS = 60 * 60 * 1000;
const ALERT_THRESHOLD = 10;

const MAX_TRACKED_ORIGINS = 10000;
export function isDevMode(): boolean {
    const nodeEnv = process.env.NODE_ENV;
    return nodeEnv === "development" || nodeEnv === "test";
}
export function isValidShopifyOrigin(origin: string | null): boolean {
    if (origin === "null") {
        return shouldAllowNullOrigin();
    }
    if (!origin) {
        return false;
    }
    return ALLOWED_ORIGIN_PATTERNS.some(({ pattern }) => pattern.test(origin));
}
export function validatePixelOriginPreBody(origin: string | null): {
    valid: boolean;
    reason: string;
    shouldLog: boolean;
    shouldReject: boolean;
} {
    const devMode = isDevMode();
    const allowNullOrigin = shouldAllowNullOrigin();
    if (origin === "null" || origin === null) {
        const allowed = allowNullOrigin;
        return {
            valid: allowed,
            reason: allowed ? "null_origin_allowed" : "null_origin_blocked",
            shouldLog: !allowed,
            shouldReject: !allowed,
        };
    }
    if (!origin) {
        return {
            valid: devMode,
            reason: devMode ? "no_origin_dev" : "missing_origin",
            shouldLog: !devMode,
            shouldReject: !devMode,
        };
    }
    try {
        const url = new URL(origin);
        if (url.protocol === "file:") {
            return { valid: false, reason: "file_protocol_blocked", shouldLog: true, shouldReject: true };
        }
        if (url.protocol === "chrome-extension:") {
            return { valid: false, reason: "chrome_extension_blocked", shouldLog: true, shouldReject: true };
        }
        if (url.protocol === "data:") {
            return { valid: false, reason: "data_protocol_blocked", shouldLog: true, shouldReject: true };
        }
        if (url.protocol === "blob:") {
            return { valid: false, reason: "blob_protocol_blocked", shouldLog: true, shouldReject: true };
        }
        if (url.protocol === "http:") {
            if (isDevMode() && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
                return { valid: true, reason: "dev_localhost_http", shouldLog: false, shouldReject: false };
            }
            return { valid: false, reason: "http_not_allowed", shouldLog: true, shouldReject: true };
        }
        if (url.protocol === "https:") {
            const hostname = url.hostname.toLowerCase();
            const isShopifyDomain = SHOPIFY_ALLOWLIST.some(domain => 
                hostname === domain || hostname.endsWith(`.${domain}`)
            );
            if (isShopifyDomain) {
                return { valid: true, reason: "https_shopify_origin", shouldLog: false, shouldReject: false };
            }
            if (ALLOWED_ORIGIN_PATTERNS.some(({ pattern }) => pattern.test(origin))) {
                return { valid: true, reason: "https_allowed_origin", shouldLog: false, shouldReject: false };
            }
            if (devMode && (hostname === "localhost" || hostname === "127.0.0.1")) {
                return { valid: true, reason: "dev_localhost_https", shouldLog: false, shouldReject: false };
            }
            return { valid: false, reason: "https_non_shopify_origin", shouldLog: true, shouldReject: true };
        }
        return { valid: false, reason: "invalid_protocol", shouldLog: true, shouldReject: true };
    }
    catch {
        return { valid: false, reason: "malformed_origin", shouldLog: true, shouldReject: true };
    }
}
export function validatePixelOriginForShop(
    origin: string | null,
    shopAllowedDomains: string[],
    options?: {
        referer?: string | null;
        shopDomain?: string | null;
    }
): {
    valid: boolean;
    reason: string;
    matched?: string;
    shouldReject: boolean;
} {
    const devMode = isDevMode();
    const allowNullOrigin = shouldAllowNullOrigin();
    let effectiveOrigin = origin;
    let originSource = "origin_header";
    if ((origin === "null" || !origin) && options) {
        if (options.referer) {
            try {
                const refererUrl = new URL(options.referer);
                effectiveOrigin = refererUrl.origin;
                originSource = "referer_header";
            } catch {
            }
        }
        if ((!effectiveOrigin || effectiveOrigin === "null") && options.shopDomain) {
            effectiveOrigin = `https://${options.shopDomain}`;
            originSource = "shop_domain_fallback";
        }
    }
    if (effectiveOrigin === "null" || effectiveOrigin === null) {
        const allowed = allowNullOrigin;
        return {
            valid: allowed,
            reason: allowed ? "null_origin_allowed" : "null_origin_blocked",
            shouldReject: !allowed,
        };
    }
    if (!effectiveOrigin) {
        return {
            valid: devMode,
            reason: devMode ? "no_origin_dev" : "missing_origin",
            shouldReject: !devMode,
        };
    }
    try {
        const url = new URL(effectiveOrigin);
        const hostname = url.hostname.toLowerCase();
        if (originSource !== "origin_header") {
            if (devMode) {
                logger.debug(`[Origin Fallback] Using ${originSource} for origin validation (dev mode)`, {
                    originalOrigin: origin,
                    effectiveOrigin,
                    shopDomain: options?.shopDomain,
                    referer: options?.referer,
                });
            } else {
                logger.warn(`[Origin Fallback] Using ${originSource} for origin validation`, {
                    originalOrigin: origin,
                    effectiveOrigin,
                    shopDomain: options?.shopDomain,
                    referer: options?.referer,
                    securityNote: "Origin header missing - using fallback. This may indicate a configuration issue or security concern.",
                    alertLevel: "warning",
                    timestamp: new Date().toISOString(),
                });
            }
        }
        if (url.protocol !== "https:" && !isDevMode()) {
            return { valid: false, reason: "https_required", shouldReject: true };
        }
        for (const domain of shopAllowedDomains) {
            const normalizedDomain = domain.toLowerCase();
            if (hostname === normalizedDomain) {
                return { valid: true, reason: "exact_match", matched: domain, shouldReject: false };
            }
            if (hostname.endsWith(`.${normalizedDomain}`)) {
                return { valid: true, reason: "subdomain_match", matched: domain, shouldReject: false };
            }
        }
        for (const shopifyDomain of SHOPIFY_ALLOWLIST) {
            if (hostname === shopifyDomain || hostname.endsWith(`.${shopifyDomain}`)) {
                return { valid: true, reason: "shopify_platform_domain", matched: shopifyDomain, shouldReject: false };
            }
        }
        if (isDevMode() && (hostname === "localhost" || hostname === "127.0.0.1")) {
            return { valid: true, reason: "dev_localhost", shouldReject: false };
        }
        trackRejectedOrigin(origin);
        return {
            valid: false,
            reason: `origin_not_allowlisted:${hostname}`,
            shouldReject: true,
        };
    }
    catch {
        return { valid: false, reason: "malformed_origin", shouldReject: true };
    }
}
function expandDomainVariants(domain: string): string[] {
    const normalized = domain.toLowerCase();
    const variants: string[] = [normalized];
    if (normalized.endsWith(".myshopify.com")) {
        return variants;
    }
    for (const shopifyDomain of SHOPIFY_ALLOWLIST) {
        if (normalized === shopifyDomain || normalized.endsWith(`.${shopifyDomain}`)) {
            return variants;
        }
    }
    if (normalized.startsWith("www.")) {
        variants.push(normalized.substring(4));
    }
    else if (!normalized.includes(".") || normalized.split(".").length === 2) {
        const parts = normalized.split(".");
        if (parts.length === 2) {
            variants.push(`www.${normalized}`);
        }
    }
    return variants;
}
export function buildShopAllowedDomains(options: {
    shopDomain: string;
    primaryDomain?: string | null;
    storefrontDomains?: string[];
}): string[] {
    const domains = new Set<string>();
    if (options.shopDomain) {
        for (const variant of expandDomainVariants(options.shopDomain)) {
            domains.add(variant);
        }
    }
    if (options.primaryDomain) {
        for (const variant of expandDomainVariants(options.primaryDomain)) {
            domains.add(variant);
        }
    }
    if (options.storefrontDomains) {
        for (const domain of options.storefrontDomains) {
            if (domain) {
                for (const variant of expandDomainVariants(domain)) {
                    domains.add(variant);
                }
            }
        }
    }
    for (const shopifyDomain of SHOPIFY_ALLOWLIST) {
        domains.add(shopifyDomain);
    }
    return Array.from(domains);
}
export function isValidPixelOrigin(origin: string | null): {
    valid: boolean;
    reason: string;
} {
    const preBodyResult = validatePixelOriginPreBody(origin);
    return { valid: preBodyResult.valid, reason: preBodyResult.reason };
}
export function isOriginInAllowlist(origin: string | null, allowedDomains: string[]): {
    valid: boolean;
    reason: string;
    matched?: string;
} {
    const result = validatePixelOriginForShop(origin, allowedDomains);
    return {
        valid: result.valid,
        reason: result.reason,
        matched: result.matched,
    };
}
export function buildDefaultAllowedDomains(myshopifyDomain: string, primaryDomain?: string | null, additionalDomains?: string[]): string[] {
    return buildShopAllowedDomains({
        shopDomain: myshopifyDomain,
        primaryDomain,
        storefrontDomains: additionalDomains,
    });
}
export function isValidDevOrigin(origin: string | null): boolean {
    if (!origin)
        return false;
    return DEV_ORIGIN_PATTERNS.some(({ pattern }) => pattern.test(origin));
}
export function validateOrigin(origin: string | null): {
    valid: boolean;
    reason: string;
    shouldLog: boolean;
} {
    if (origin === "null") {
        const allowed = shouldAllowNullOrigin();
        return { valid: allowed, reason: allowed ? "null_origin_allowed" : "null_origin_blocked", shouldLog: !allowed };
    }
    if (!origin) {
        return { valid: false, reason: "missing_origin", shouldLog: true };
    }
    for (const { pattern, description } of ALLOWED_ORIGIN_PATTERNS) {
        if (pattern.test(origin)) {
            return { valid: true, reason: description, shouldLog: false };
        }
    }
    if (isDevMode()) {
        for (const { pattern, description } of DEV_ORIGIN_PATTERNS) {
            if (pattern.test(origin)) {
                return { valid: true, reason: `dev:${description}`, shouldLog: false };
            }
        }
    }
    trackRejectedOrigin(origin);
    return { valid: false, reason: "unknown_origin", shouldLog: true };
}
function trackRejectedOrigin(origin: string): void {
    const now = Date.now();
    const sanitizedOrigin = sanitizeOriginForLogging(origin);
    const existing = rejectedOrigins.get(sanitizedOrigin);
    if (!existing || (now - existing.firstSeen) > TRACKING_WINDOW_MS) {
        if (rejectedOrigins.size >= MAX_TRACKED_ORIGINS) {
            evictOldestEntries(Math.ceil(MAX_TRACKED_ORIGINS * 0.1));
        }
        rejectedOrigins.set(sanitizedOrigin, {
            count: 1,
            firstSeen: now,
            lastSeen: now,
        });
    }
    else {
        existing.count++;
        existing.lastSeen = now;
        if (existing.count === ALERT_THRESHOLD) {
            logger.warn(`[SECURITY] Repeated requests from non-Shopify origin`, {
                origin: sanitizedOrigin,
                count: existing.count,
                windowMinutes: Math.round((now - existing.firstSeen) / 60000),
                securityAlert: "rejected_origin_abuse",
            });
        }
    }
}

function evictOldestEntries(count: number): void {
    if (rejectedOrigins.size === 0) return;
    const entries = Array.from(rejectedOrigins.entries())
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    const toRemove = entries.slice(0, count);
    for (const [origin] of toRemove) {
        rejectedOrigins.delete(origin);
    }
    if (toRemove.length > 0) {
        logger.info(`[Origin Tracking] Evicted ${toRemove.length} stale entries (size limit: ${MAX_TRACKED_ORIGINS})`);
    }
}
function sanitizeOriginForLogging(origin: string): string {
    try {
        const url = new URL(origin);
        return `${url.protocol}//${url.hostname}`;
    }
    catch {
        return origin.substring(0, 50);
    }
}
export function getRejectionStats(): Array<{
    origin: string;
    count: number;
    firstSeen: Date;
    lastSeen: Date;
}> {
    const now = Date.now();
    const stats: Array<{
        origin: string;
        count: number;
        firstSeen: Date;
        lastSeen: Date;
    }> = [];
    rejectedOrigins.forEach((tracker, origin) => {
        if ((now - tracker.lastSeen) <= TRACKING_WINDOW_MS) {
            stats.push({
                origin,
                count: tracker.count,
                firstSeen: new Date(tracker.firstSeen),
                lastSeen: new Date(tracker.lastSeen),
            });
        }
    });
    return stats.sort((a, b) => b.count - a.count);
}
export function cleanupRejectionTracking(): number {
    const now = Date.now();
    let cleaned = 0;
    rejectedOrigins.forEach((tracker, origin) => {
        if ((now - tracker.lastSeen) > TRACKING_WINDOW_MS) {
            rejectedOrigins.delete(origin);
            cleaned++;
        }
    });
    return cleaned;
}
export function getAllowedPatterns(): Array<{
    pattern: string;
    description: string;
    example?: string;
}> {
    const nullOriginAllowed = shouldAllowNullOrigin();
    return [
        {
            pattern: 'Origin: "null"',
            description: nullOriginAllowed
                ? "Web Pixel sandbox (allowed by policy)"
                : "Web Pixel sandbox (blocked: set PIXEL_ALLOW_NULL_ORIGIN=true to allow)",
            example: 'Origin: null',
        },
        ...ALLOWED_ORIGIN_PATTERNS.map(p => ({
            pattern: p.pattern.toString(),
            description: p.description,
            example: p.example,
        })),
        ...(isDevMode() ? DEV_ORIGIN_PATTERNS.map(p => ({
            pattern: p.pattern.toString(),
            description: `[DEV] ${p.description}`,
        })) : []),
    ];
}
export function extractOriginHost(origin: string | null): string | null {
    if (!origin || origin === "null") {
        return null;
    }
    try {
        const url = new URL(origin);
        return url.hostname;
    }
    catch {
        return null;
    }
}
