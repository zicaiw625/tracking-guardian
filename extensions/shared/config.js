/**
 * Shared Configuration for Shopify Extensions
 *
 * P0-1: This file runs in Shopify's strict sandbox where process/Node globals
 * are NOT available. All code must be browser-safe without any Node.js dependencies.
 *
 * BACKEND_URL is injected at build time via ext:inject script.
 * If the placeholder is not replaced, the URL will be null and pixel events
 * will be silently disabled (fail-closed strategy).
 */
const BUILD_TIME_URL = "__BACKEND_URL_PLACEHOLDER__";
/**
 * P0-1: Resolve backend URL with strict sandbox safety
 *
 * Returns null if the placeholder was not replaced at build time.
 * The calling code MUST handle null and disable event sending.
 *
 * IMPORTANT: Do NOT use process, require, or any Node.js globals here.
 * This code runs in Shopify's Web Pixel strict sandbox.
 */
function resolveBackendUrl() {
    // Check if the placeholder was replaced at build time
    if (BUILD_TIME_URL && !BUILD_TIME_URL.includes("PLACEHOLDER")) {
        return BUILD_TIME_URL;
    }
    // P0-1: Fail-closed - if placeholder not replaced, return null
    // The pixel will silently disable event sending rather than crash or
    // send to a wrong URL. This is safer than fallback to any URL.
    return null;
}
/**
 * Backend URL for API calls.
 *
 * IMPORTANT: This may be null if build-time injection failed.
 * All consuming code MUST check for null before using.
 */
export const BACKEND_URL = resolveBackendUrl();
export const ALLOWED_BACKEND_HOSTS = [
    "tracking-guardian.onrender.com",
    "tracking-guardian-staging.onrender.com",
];
export const DEV_HOSTS = [
    "localhost",
    "127.0.0.1",
];
/**
 * Check if a URL is an allowed backend host.
 * Returns false for null/invalid URLs.
 */
export function isAllowedBackendUrl(url) {
    if (!url)
        return false;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        return (ALLOWED_BACKEND_HOSTS.includes(host) ||
            DEV_HOSTS.includes(host));
    }
    catch {
        return false;
    }
}
