

const BUILD_TIME_URL = "__BACKEND_URL_PLACEHOLDER__";

function resolveBackendUrl() {

    if (BUILD_TIME_URL && !BUILD_TIME_URL.includes("PLACEHOLDER")) {
        return BUILD_TIME_URL;
    }

    return null;
}

export const BACKEND_URL = resolveBackendUrl();
export const ALLOWED_BACKEND_HOSTS = [
    "tracking-guardian.onrender.com",
    "tracking-guardian-staging.onrender.com",
];
export const DEV_HOSTS = [
    "localhost",
    "127.0.0.1",
];

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
