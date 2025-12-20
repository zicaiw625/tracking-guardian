/**
 * Shared configuration for Shopify Extensions
 * 
 * P0-2: Centralized URL Management
 * 
 * DEPLOYMENT INSTRUCTIONS:
 * ------------------------
 * For different environments, update BACKEND_URL before building extensions:
 * 
 * Production:
 *   export BACKEND_URL="https://tracking-guardian.onrender.com"
 *   shopify app deploy
 * 
 * Staging:
 *   export BACKEND_URL="https://tracking-guardian-staging.onrender.com"
 *   shopify app deploy
 * 
 * Local Development:
 *   Uses the development URL automatically via ngrok tunnel
 *   (set via SHOPIFY_APP_URL in .env)
 * 
 * NOTE: This is a compile-time constant. Each environment needs a 
 * separate extension build with the correct URL baked in.
 * 
 * SECURITY: The URL is intentionally NOT merchant-configurable to prevent
 * data exfiltration concerns during App Store review. Only trusted domains
 * controlled by the app developer are allowed.
 */

// P0-2: Single source of truth for backend URL
// This value is checked during CI/CD to ensure it matches the deployment target
export const BACKEND_URL = process.env.BACKEND_URL || "https://tracking-guardian.onrender.com";

// Validation: Ensure only allowed domains are used
const ALLOWED_DOMAINS = [
  "tracking-guardian.onrender.com",
  "tracking-guardian-staging.onrender.com",
  "localhost",
  "127.0.0.1",
];

/**
 * Validate that the backend URL is from an allowed domain
 * This runs at module load time in development, and should be checked in CI/CD
 */
export function validateBackendUrl(url: string = BACKEND_URL): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    
    const isAllowed = ALLOWED_DOMAINS.some(domain => 
      host === domain || host.endsWith(`.${domain}`)
    );
    
    if (!isAllowed) {
      console.error(
        `[Config] Invalid BACKEND_URL: ${url}\n` +
        `Allowed domains: ${ALLOWED_DOMAINS.join(", ")}`
      );
      return false;
    }
    
    return true;
  } catch {
    console.error(`[Config] Invalid BACKEND_URL format: ${url}`);
    return false;
  }
}

// Development-time validation
if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
  validateBackendUrl();
}

