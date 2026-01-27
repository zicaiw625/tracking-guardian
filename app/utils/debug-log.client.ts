const isDev = typeof window !== "undefined" && (
  process.env.NODE_ENV === "development" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname.includes(".local")
);

export function debugLog(...args: unknown[]): void {
  if (isDev) {
    console.log(...args);
  }
}

export function debugError(...args: unknown[]): void {
  if (isDev) {
    console.error(...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (isDev) {
    console.warn(...args);
  }
}

export function debugInfo(...args: unknown[]): void {
  if (isDev) {
    console.info(...args);
  }
}

export function debugDebug(...args: unknown[]): void {
  if (isDev) {
    console.debug(...args);
  }
}
