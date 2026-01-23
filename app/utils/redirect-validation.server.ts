import { logger } from "./logger.server";

export function isSafeRedirectPath(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("://") &&
    !/^(javascript|data|vbscript|file):/i.test(value.trim())
  );
}

export function filterDangerousRedirectParams(sp: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of sp.entries()) {
    const s = String(v).trim();
    if (s.startsWith("//") || /^(https?|javascript|data|vbscript|file):/i.test(s)) continue;
    out.append(k, v);
  }
  return out;
}

export interface RedirectValidationResult {
  valid: boolean;
  error?: string;
}

export function assertSafeRedirect(
  url: string,
  allowedDomains: string[]
): RedirectValidationResult {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== "https:") {
      return {
        valid: false,
        error: `Invalid protocol: ${urlObj.protocol}`,
      };
    }
    const hostname = urlObj.hostname.toLowerCase();
    
    const isAllowed = allowedDomains.some(domain => {
      const normalizedDomain = domain.toLowerCase();
      return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
    });
    
    if (!isAllowed) {
      logger.error(`Invalid redirect domain: ${hostname}`, {
        url,
        allowedDomains,
      });
      return {
        valid: false,
        error: `Domain ${hostname} is not in allowed list`,
      };
    }
    
    return { valid: true };
  } catch (error) {
    logger.error(`Invalid redirect URL format: ${url}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      valid: false,
      error: `Invalid URL format: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
