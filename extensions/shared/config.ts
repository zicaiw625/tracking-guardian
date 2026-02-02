const BUILD_TIME_URL = "https://tracking-guardian.onrender.com";

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
      // no-op: invalid BACKEND_URL, return [] below
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

export function isAllowedBackendUrl(
  url: string | null,
  context?: { shopDomain?: string | null; hostname?: string | null }
): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isDev = isDevMode(context);
    if (!isDev && parsed.protocol !== "https:") {
      return false;
    }
    if (DEV_HOSTS.includes(host as typeof DEV_HOSTS[number])) {
      return isDev;
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

function resolveHostname(context?: { shopDomain?: string | null; hostname?: string | null }): string | null {
  if (context?.hostname) {
    return context.hostname;
  }
  if (context?.shopDomain) {
    return context.shopDomain;
  }
  if (typeof globalThis !== "undefined") {
    const location = (globalThis as { location?: { hostname?: string } }).location;
    if (location?.hostname) {
      return location.hostname;
    }
  }
  return null;
}

export function isDevMode(context?: { shopDomain?: string | null; hostname?: string | null }): boolean {
  try {
    const hostname = resolveHostname(context);
    if (!hostname) {
      return false;
    }
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(hostname)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
