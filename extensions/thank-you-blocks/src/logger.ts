export interface Logger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  isDevMode: boolean;
}

export function createLogger(shopDomain: string, prefix: string = "[Tracking Guardian]"): Logger {
  const isDevMode = (() => {
    if (!shopDomain) return false;

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
