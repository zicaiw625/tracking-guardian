export function suppressMonorailErrors() {
  if (typeof window === "undefined") return;
  const isDev = 
    process.env.NODE_ENV === "development" || 
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.includes(".local");
  if (!isDev) return;
  const isTelemetryMessage = (value: string): boolean => {
    const normalized = value.toLowerCase();
    return (
      normalized.includes("monorail-edge.shopifysvc.com") ||
      normalized.includes("shopifysvc.com/v1/produce") ||
      normalized.includes("shopifysvc.com/v1/produce_batch")
    );
  };
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const isTelemetryError = (args: unknown[]): boolean => {
    const errorMessage = args.map(arg => 
      typeof arg === "string" ? arg : 
      arg instanceof Error ? arg.message : 
      String(arg)
    ).join(" ");
    return (
      isTelemetryMessage(errorMessage) ||
      (errorMessage.includes("ERR_CONNECTION_REFUSED") && errorMessage.includes("shopifysvc.com")) ||
      (errorMessage.includes("Failed to load resource") && errorMessage.includes("shopifysvc.com"))
    );
  };
  console.error = (...args: unknown[]) => {
    if (isTelemetryError(args)) {
      return; 
    }
    originalConsoleError.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    if (isTelemetryError(args)) {
      return; 
    }
    originalConsoleWarn.apply(console, args);
  };
  const errorHandler = (event: ErrorEvent) => {
    const errorMessage = event.message || "";
    const filename = event.filename || "";
    if (
      isTelemetryMessage(errorMessage) ||
      isTelemetryMessage(filename) ||
      (errorMessage.includes("ERR_CONNECTION_REFUSED") && filename.includes("shopifysvc.com"))
    ) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  };
  window.addEventListener("error", errorHandler, true);
  const rejectionHandler = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const errorMessage = 
      reason?.message || 
      reason?.toString() || 
      String(reason || "");
    if (
      isTelemetryMessage(errorMessage) ||
      (errorMessage.includes("ERR_CONNECTION_REFUSED") && errorMessage.includes("shopifysvc.com")) ||
      (errorMessage.includes("Failed to fetch") && errorMessage.includes("shopifysvc.com"))
    ) {
      event.preventDefault();
      return false;
    }
  };
  window.addEventListener("unhandledrejection", rejectionHandler);
  const isTelemetryUrl = (url: string): boolean => {
    if (!url) return false;
    try {
      const parsed = new URL(url, window.location.origin);
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      if (host === "monorail-edge.shopifysvc.com") {
        return true;
      }
      if (host.endsWith(".shopifysvc.com")) {
        return pathname.includes("/v1/produce") || pathname.includes("/v1/produce_batch");
      }
      return false;
    } catch {
      return isTelemetryMessage(url);
    }
  };
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : (args[0] && typeof args[0] === "object" && "url" in args[0] ? (args[0] as Request).url : "");
    if (isTelemetryUrl(url)) {
      return Promise.resolve(new Response(null, { 
        status: 200, 
        statusText: "OK",
        headers: new Headers({ "Content-Type": "application/json" }),
      }));
    }
    try {
      const response = await originalFetch(...args);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("ERR_CONNECTION_REFUSED") ||
        errorMessage.includes("Failed to fetch") ||
        errorMessage.includes("NetworkError")
      ) {
        const requestInfo = args[0];
        if (requestInfo && typeof requestInfo === "object" && "url" in requestInfo) {
          if (isTelemetryUrl((requestInfo as { url: string }).url)) {
            return Promise.resolve(new Response(null, { 
              status: 200, 
              statusText: "OK",
              headers: new Headers({ "Content-Type": "application/json" }),
            }));
          }
        }
      }
      throw error;
    }
  };
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = class extends OriginalXHR {
    private _url: string | null = null;
    private _isTelemetryRequest = false;
    open(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null): void {
      this._url = typeof url === "string" ? url : url.toString();
      this._isTelemetryRequest = isTelemetryUrl(this._url);
      if (this._isTelemetryRequest) {
        try {
          super.open(method, "about:blank", async ?? true, username ?? null, password ?? null);
        } catch {
          // no-op: ignore if about:blank open fails
        }
        return;
      }
      return super.open(method, url, async ?? true, username ?? null, password ?? null);
    }
    send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (this._isTelemetryRequest) {
        try {
          Object.defineProperty(this, "readyState", { 
            value: 4, 
            writable: false, 
            configurable: true 
          });
          Object.defineProperty(this, "status", { 
            value: 200, 
            writable: false, 
            configurable: true 
          });
          Object.defineProperty(this, "statusText", { 
            value: "OK", 
            writable: false, 
            configurable: true 
          });
          Object.defineProperty(this, "responseText", { 
            value: "{}", 
            writable: false, 
            configurable: true 
          });
          setTimeout(() => {
            try {
              if (this.onreadystatechange) {
                this.onreadystatechange(new ProgressEvent("readystatechange"));
              }
              if (this.onload) {
                this.onload(new ProgressEvent("load"));
              }
            } catch {
              // no-op: ignore callback errors
            }
          }, 0);
        } catch {
          // no-op: ignore defineProperty/setTimeout errors
        }
        return;
      }
      return super.send(body ?? null);
    }
  } as typeof XMLHttpRequest;
  return () => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    window.fetch = originalFetch;
    window.XMLHttpRequest = OriginalXHR;
    window.removeEventListener("error", errorHandler, true);
    window.removeEventListener("unhandledrejection", rejectionHandler);
  };
}
