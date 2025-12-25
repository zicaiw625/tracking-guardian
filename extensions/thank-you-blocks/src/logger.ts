/**
 * Shared Logger Utility
 *
 * Provides a dev-mode-only logger to prevent console noise in production.
 * Centralizes the logic for detecting development mode based on shop domain.
 */

export interface Logger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  isDevMode: boolean;
}

/**
 * Creates a logger instance that only logs when in development mode.
 * 
 * @param shopDomain The shop domain (e.g. my-shop.myshopify.com)
 * @param prefix Optional prefix for log messages (default: "[Tracking Guardian]")
 */
export function createLogger(shopDomain: string, prefix: string = "[Tracking Guardian]"): Logger {
  const isDevMode = (() => {
    if (!shopDomain) return false;
    // Check for standard dev shop domains or common dev/staging patterns
    if (shopDomain.includes(".myshopify.dev") || /-(dev|staging|test)\./i.test(shopDomain)) {
      return true;
    }
    return false;
  })();

  return {
    isDevMode,
    log: (...args: unknown[]) => {
      if (isDevMode) {
        console.log(prefix, ...args);
      }
    },
    warn: (...args: unknown[]) => {
      // In some cases we might want warnings in production, but for now we gate them too
      // to match the user's request for "strict dev mode".
      if (isDevMode) {
        console.warn(prefix, ...args);
      }
    },
    error: (...args: unknown[]) => {
      if (isDevMode) {
        console.error(prefix, ...args);
      }
    },
  };
}
