export const BACKEND_URL = process.env.BACKEND_URL || "https://tracking-guardian.onrender.com";

const ALLOWED_DOMAINS = [
  "tracking-guardian.onrender.com",
  "tracking-guardian-staging.onrender.com",
  "localhost",
  "127.0.0.1",
];

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

if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
  validateBackendUrl();
}
