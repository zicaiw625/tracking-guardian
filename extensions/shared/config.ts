// P0-5: Build-time environment variable injection
// 
// For production deployment:
// 1. Set SHOPIFY_APP_URL environment variable before building
// 2. Run build script: npm run build:extensions
// 
// The build process will replace __BACKEND_URL_PLACEHOLDER__ with the actual URL.
// If not replaced, falls back to the production default.
// 
// For local development:
// - Uses SHOPIFY_APP_URL from environment if available
// - Falls back to production URL if not set

// Default production URL - replaced at build time via scripts/build-extensions.ts
const BUILD_TIME_URL = "__BACKEND_URL_PLACEHOLDER__";

// Determine the actual backend URL
function resolveBackendUrl(): string {
  // If build-time replacement was done, use that
  if (BUILD_TIME_URL && !BUILD_TIME_URL.includes("PLACEHOLDER")) {
    return BUILD_TIME_URL;
  }
  
  // Fallback to production URL
  return "https://tracking-guardian.onrender.com";
}

export const BACKEND_URL = resolveBackendUrl();

export const ALLOWED_BACKEND_HOSTS = [
  "tracking-guardian.onrender.com",
  "tracking-guardian-staging.onrender.com",
] as const;

export const DEV_HOSTS = [
  "localhost",
  "127.0.0.1",
] as const;

export function isAllowedBackendUrl(url: string): boolean {
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
