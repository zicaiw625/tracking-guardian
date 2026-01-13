const BUILD_TIME_URL = "__BACKEND_URL_PLACEHOLDER__";

function resolveBackendUrl(): string | null {
  if (BUILD_TIME_URL && !BUILD_TIME_URL.includes("PLACEHOLDER")) {
    return BUILD_TIME_URL;
  }
  return null;
}

export const BACKEND_URL: string | null = resolveBackendUrl();

function getDefaultAllowedHosts(): string[] {
  const backendUrl = BACKEND_URL;
  if (backendUrl) {
    try {
      const url = new URL(backendUrl);
      const hostname = url.hostname;
      return [hostname];
    } catch {
    }
  }
  return [];
}

function getAllowedHosts(): string[] {
  return getDefaultAllowedHosts();
}

export const ALLOWED_BACKEND_HOSTS = getAllowedHosts();

export const DEV_HOSTS = [
  "localhost",
  "127.0.0.1",
] as const;

function matchesWildcard(hostname: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return hostname === pattern;
  }
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*");
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(hostname);
}

export function isAllowedBackendUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (DEV_HOSTS.includes(host as typeof DEV_HOSTS[number])) {
      return true;
    }
    for (const allowedHost of ALLOWED_BACKEND_HOSTS) {
      if (allowedHost.includes("*")) {
        if (matchesWildcard(host, allowedHost)) {
          return true;
        }
      } else if (host === allowedHost) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function isDevMode(): boolean {
  try {
    if (typeof window !== "undefined" && window.location) {
      const hostname = window.location.hostname;
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(hostname)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
