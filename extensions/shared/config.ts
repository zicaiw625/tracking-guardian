

const BUILD_TIME_URL = "__BACKEND_URL_PLACEHOLDER__";

function resolveBackendUrl(): string | null {

  if (BUILD_TIME_URL && !BUILD_TIME_URL.includes("PLACEHOLDER")) {
    return BUILD_TIME_URL;
  }

  return null;
}

export const BACKEND_URL: string | null = resolveBackendUrl();

export const ALLOWED_BACKEND_HOSTS = [
  "tracking-guardian.onrender.com",
  "tracking-guardian-staging.onrender.com",
] as const;

export const DEV_HOSTS = [
  "localhost",
  "127.0.0.1",
] as const;

export function isAllowedBackendUrl(url: string | null): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname;

    return (
      ALLOWED_BACKEND_HOSTS.includes(host as typeof ALLOWED_BACKEND_HOSTS[number]) ||
      DEV_HOSTS.includes(host as typeof DEV_HOSTS[number])
    );
  } catch {
    return false;
  }
}
