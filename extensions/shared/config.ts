const BUILD_TIME_URL = "__BACKEND_URL_PLACEHOLDER__";

function resolveBackendUrl(): string | null {
  if (BUILD_TIME_URL && !BUILD_TIME_URL.includes("PLACEHOLDER")) {
    return BUILD_TIME_URL;
  }
  if (typeof process !== "undefined" && process.env && process.env.BACKEND_URL) {
    return process.env.BACKEND_URL;
  }
  return null;
}

export const BACKEND_URL: string | null = resolveBackendUrl();

function getDefaultAllowedHosts(): string[] {
  const buildTimeHosts = typeof process !== "undefined" && process.env && process.env.BUILD_TIME_ALLOWED_HOSTS
    ? process.env.BUILD_TIME_ALLOWED_HOSTS.split(",").map(h => h.trim()).filter(Boolean)
    : [];
  if (buildTimeHosts.length > 0) {
    return buildTimeHosts;
  }
  const backendUrl = BACKEND_URL;
  if (backendUrl) {
    try {
      const url = new URL(backendUrl);
      const hostname = url.hostname;
      const domainParts = hostname.split(".");
      if (domainParts.length >= 2) {
        const rootDomain = domainParts.slice(-2).join(".");
        return [
          hostname,
          `*.${rootDomain}`,
        ];
      }
      return [hostname];
    } catch {
    }
  }
  const envDefaultHosts = typeof process !== "undefined" && process.env && process.env.DEFAULT_ALLOWED_HOSTS
    ? process.env.DEFAULT_ALLOWED_HOSTS.split(",").map(h => h.trim()).filter(Boolean)
    : [];
  if (envDefaultHosts.length > 0) {
    return envDefaultHosts;
  }
  const fallbackHosts = typeof process !== "undefined" && process.env && process.env.FALLBACK_ALLOWED_HOSTS
    ? process.env.FALLBACK_ALLOWED_HOSTS.split(",").map(h => h.trim()).filter(Boolean)
    : null;
  if (fallbackHosts && fallbackHosts.length > 0) {
    return fallbackHosts;
  }
  return [
    "tracking-guardian.onrender.com",
    "tracking-guardian-staging.onrender.com",
    "*.onrender.com",
  ];
}

function getAllowedHosts(): string[] {
  if (typeof process !== "undefined" && process.env && process.env.ALLOWED_BACKEND_HOSTS) {
    const envHosts = process.env.ALLOWED_BACKEND_HOSTS.split(",").map(h => h.trim()).filter(Boolean);
    if (envHosts.length > 0) {
      if (process.env.ALLOWED_BACKEND_HOSTS_OVERRIDE === "true") {
        return envHosts;
      }
      const defaultHosts = getDefaultAllowedHosts();
      return [...defaultHosts, ...envHosts];
    }
  }
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
