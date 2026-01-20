import { logger } from "./logger.server";

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
