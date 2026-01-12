const BUILD_TIME_URL = "__BACKEND_URL_PLACEHOLDER__";
function resolveBackendUrl() {
    if (BUILD_TIME_URL && !BUILD_TIME_URL.includes("PLACEHOLDER")) {
        return BUILD_TIME_URL;
    }
    if (typeof process !== "undefined" && process.env && process.env.BACKEND_URL) {
        return process.env.BACKEND_URL;
    }
    return null;
}
export const BACKEND_URL = resolveBackendUrl();
const DEFAULT_ALLOWED_HOSTS = [
    "tracking-guardian.onrender.com",
    "tracking-guardian-staging.onrender.com",
];
function getAllowedHosts() {
    const envHosts = typeof process !== "undefined" && process.env && process.env.ALLOWED_BACKEND_HOSTS
        ? process.env.ALLOWED_BACKEND_HOSTS.split(",").map(h => h.trim()).filter(Boolean)
        : [];
    return [...DEFAULT_ALLOWED_HOSTS, ...envHosts];
}
export const ALLOWED_BACKEND_HOSTS = getAllowedHosts();
export const DEV_HOSTS = [
    "localhost",
    "127.0.0.1",
];
function matchesWildcard(hostname, pattern) {
    if (!pattern.includes("*")) {
        return hostname === pattern;
    }
    const regexPattern = pattern
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*");
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(hostname);
}
export function isAllowedBackendUrl(url) {
    if (!url)
        return false;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        if (DEV_HOSTS.includes(host)) {
            return true;
        }
        for (const allowedHost of ALLOWED_BACKEND_HOSTS) {
            if (allowedHost.includes("*")) {
                if (matchesWildcard(host, allowedHost)) {
                    return true;
                }
            }
            else if (host === allowedHost) {
                return true;
            }
        }
        return false;
    }
    catch {
        return false;
    }
}
