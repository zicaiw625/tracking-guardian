import { logger } from "./logger.server";
import { randomBytes } from "crypto";

export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;
const DEFAULT_MAX_REDIRECTS = 5;

const ALLOWED_OUTBOUND_HOSTS = [
  "admin.shopify.com",
  "*.admin.shopify.com",
  "*.myshopify.com",
  "graphql.shopify.com",
  "*.graphql.shopify.com",
  "graph.facebook.com",
  "*.graph.facebook.com",
  "graph.facebook.net",
  "*.graph.facebook.net",
  "google-analytics.com",
  "*.google-analytics.com",
  "analyticsdata.googleapis.com",
  "*.analyticsdata.googleapis.com",
  "www.googleapis.com",
  "*.googleapis.com",
  "hooks.slack.com",
  "api.resend.com",
  "api.telegram.org",
  "business-api.tiktok.com",
] as const;

function envIsTrue(key: string): boolean {
  const v = process.env[key];
  if (!v) return false;
  const normalized = v.toLowerCase().trim();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function isHostAllowed(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  for (const pattern of ALLOWED_OUTBOUND_HOSTS) {
    if (pattern.startsWith("*.")) {
      const domain = pattern.slice(2);
      if (normalized === domain || normalized.endsWith(`.${domain}`)) {
        return true;
      }
    } else {
      if (normalized === pattern) {
        return true;
      }
    }
  }
  return false;
}

export function validateOutboundUrl(url: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { valid: false, reason: `Invalid protocol: ${parsed.protocol}` };
    }
    const localhost = isLocalhost(parsed.hostname);
    if (parsed.protocol === "http:" && !localhost) {
      return { valid: false, reason: "HTTP protocol not allowed for non-localhost URLs" };
    }
    if (localhost) {
      const allowLocalhostOutbound =
        process.env.NODE_ENV !== "production" &&
        (envIsTrue("ALLOW_LOCALHOST_OUTBOUND") || envIsTrue("ALLOW_HTTP_LOCALHOST_OUTBOUND"));
      if (!allowLocalhostOutbound) {
        return { valid: false, reason: "Localhost outbound requests are disabled" };
      }
      return { valid: true };
    }
    if (isPrivateIP(parsed.hostname)) {
      return { valid: false, reason: "Private IP addresses are not allowed" };
    }
    if (!isHostAllowed(parsed.hostname)) {
      return { valid: false, reason: `Host not in allowlist: ${parsed.hostname}` };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, reason: `Invalid URL: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "0.0.0.0";
}

function isPrivateIP(hostname: string): boolean {
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  if (/^fc00:/i.test(hostname)) return true;
  if (/^fe80:/i.test(hostname)) return true;
  return false;
}

export interface HttpRequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: Array<"timeout" | "network" | "5xx" | "429">;
  maxRedirects?: number;
}

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  data: T;
  duration: number;
}

export interface HttpError {
  type: "timeout" | "network" | "http" | "parse" | "unknown";
  message: string;
  status?: number;
  retryable: boolean;
  retryAfter?: number;
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  maxDelayMs: number = DEFAULT_MAX_DELAY_MS
): number {
  const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.floor(exponentialDelay + jitter);
}

export function isRetryableStatus(
  status: number,
  retryOn: HttpRequestOptions["retryOn"] = ["timeout", "network", "5xx", "429"]
): boolean {
  if (retryOn.includes("5xx") && status >= 500) return true;
  if (retryOn.includes("429") && status === 429) return true;
  return false;
}

export function extractRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return undefined;
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeUrlForLogs(raw: string): string {
  try {
    const u = new URL(raw);
    u.search = "";
    return u.toString();
  } catch {
    return "[invalid-url]";
  }
}

function getMethod(options: RequestInit): string {
  return (options.method ?? "GET").toUpperCase();
}

function stripBodyAndContentHeaders(options: RequestInit): RequestInit {
  const next: RequestInit = { ...options, body: undefined };
  const h = options.headers;
  if (!h) return next;
  if (h instanceof Headers) {
    const cloned = new Headers(h);
    cloned.delete("content-type");
    cloned.delete("content-length");
    next.headers = cloned;
    return next;
  }
  if (Array.isArray(h)) {
    next.headers = h.filter(([k]) => {
      const key = String(k).toLowerCase();
      return key !== "content-type" && key !== "content-length";
    });
    return next;
  }
  next.headers = Object.fromEntries(
    Object.entries(h).filter(([k]) => {
      const key = k.toLowerCase();
      return key !== "content-type" && key !== "content-length";
    })
  );
  return next;
}

export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const urlValidation = validateOutboundUrl(url);
  if (!urlValidation.valid) {
    logger.error(`[SSRF Protection] Blocked outbound request to ${safeUrlForLogs(url)}: ${urlValidation.reason}`);
    const duration = 0;
    const errorData: HttpError = {
      type: "unknown",
      message: `SSRF protection: ${urlValidation.reason || "URL not allowed"}`,
      retryable: false,
    };
    return {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: new Headers(),
      data: errorData as T,
      duration,
    };
  }
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    retries = 0,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    retryOn = ["timeout", "network", "5xx", "429"],
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    ...fetchOptions
  } = options as HttpRequestOptions & { maxRedirects?: number };
  let lastError: Error | undefined;
  const startTime = Date.now();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let currentUrl = url;
      let redirects = 0;
      let currentFetchOptions: RequestInit = { ...fetchOptions };

      for (;;) {
        const response = await fetchWithTimeout(currentUrl, { ...currentFetchOptions, redirect: "manual" }, timeout);

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) {
            const duration = Date.now() - startTime;
            let data: T;
            const contentType = response.headers.get("content-type");
            if (contentType?.includes("application/json")) {
              data = (await response.json()) as T;
            } else {
              const text = await response.text();
              data = (typeof text === "string" ? text : { type: "text", content: text }) as T;
            }
            return {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              data,
              duration,
            };
          }
          if (redirects >= maxRedirects) {
            logger.error(`[SSRF Protection] Blocked redirect chain (too many redirects) for ${safeUrlForLogs(url)}`);
            const duration = Date.now() - startTime;
            const errorData: HttpError = {
              type: "http",
              message: "Too many redirects",
              status: 502,
              retryable: false,
            };
            return {
              ok: false,
              status: 502,
              statusText: "Bad Gateway",
              headers: new Headers(),
              data: errorData as T,
              duration,
            };
          }

          let nextUrl: string;
          try {
            nextUrl = new URL(location, currentUrl).toString();
          } catch (e) {
            logger.error(
              `[SSRF Protection] Blocked invalid redirect location from ${safeUrlForLogs(currentUrl)}: ${String(e)}`
            );
            const duration = Date.now() - startTime;
            const errorData: HttpError = {
              type: "parse",
              message: "Invalid redirect location",
              retryable: false,
            };
            return {
              ok: false,
              status: 502,
              statusText: "Bad Gateway",
              headers: new Headers(),
              data: errorData as T,
              duration,
            };
          }

          const redirectValidation = validateOutboundUrl(nextUrl);
          if (!redirectValidation.valid) {
            logger.error(
              `[SSRF Protection] Blocked redirect to ${safeUrlForLogs(nextUrl)}: ${redirectValidation.reason}`
            );
            const duration = Date.now() - startTime;
            const errorData: HttpError = {
              type: "unknown",
              message: `SSRF protection: ${redirectValidation.reason || "redirect URL not allowed"}`,
              retryable: false,
            };
            return {
              ok: false,
              status: 403,
              statusText: "Forbidden",
              headers: new Headers(),
              data: errorData as T,
              duration,
            };
          }

          // Match fetch redirect behavior more closely:
          // - 303: switch to GET (except HEAD), drop body
          // - 301/302: if POST, switch to GET, drop body (legacy behavior)
          const method = getMethod(currentFetchOptions);
          if (response.status === 303 && method !== "GET" && method !== "HEAD") {
            currentFetchOptions = stripBodyAndContentHeaders({ ...currentFetchOptions, method: "GET" });
          } else if ((response.status === 301 || response.status === 302) && method === "POST") {
            currentFetchOptions = stripBodyAndContentHeaders({ ...currentFetchOptions, method: "GET" });
          }

          redirects++;
          currentUrl = nextUrl;
          continue;
        }

        const duration = Date.now() - startTime;
        if (!response.ok && isRetryableStatus(response.status, retryOn) && attempt < retries) {
          const retryAfter = extractRetryAfter(response) || calculateBackoffDelay(attempt + 1, baseDelayMs, maxDelayMs);
          logger.debug(`HTTP ${response.status} from ${safeUrlForLogs(currentUrl)}, retrying in ${retryAfter}ms`, {
            attempt: attempt + 1,
            maxAttempts: retries + 1,
          });
          await sleep(retryAfter);
          // retry the whole request (including redirects)
          break;
        }

        let data: T;
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          data = (await response.json()) as T;
        } else {
          const text = await response.text();
          data = (typeof text === "string" ? text : { type: "text", content: text }) as T;
        }
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data,
          duration,
        };
      }

      // if we got here, it means we intentionally broke to outer retry loop
      continue;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const duration = Date.now() - startTime;
      const isTimeout = lastError.name === "AbortError";
      const isNetwork = lastError.message.includes("fetch") || lastError.message.includes("network");
      const shouldRetry =
        attempt < retries && ((isTimeout && retryOn.includes("timeout")) || (isNetwork && retryOn.includes("network")));
      if (shouldRetry) {
        const delay = calculateBackoffDelay(attempt + 1, baseDelayMs, maxDelayMs);
        logger.debug(`HTTP error: ${lastError.message}, retrying in ${delay}ms`, {
          url: safeUrlForLogs(url),
          attempt: attempt + 1,
          maxAttempts: retries + 1,
          isTimeout,
          isNetwork,
        });
        await sleep(delay);
        continue;
      }
      const httpError: HttpError = {
        type: isTimeout ? "timeout" : isNetwork ? "network" : "unknown",
        message: lastError.message,
        retryable: false,
      };
      return {
        ok: false,
        status: isTimeout ? 408 : 0,
        statusText: httpError.type,
        headers: new Headers(),
        data: httpError as T,
        duration,
      };
    }
  }
  const duration = Date.now() - startTime;
  const errorData: HttpError = {
    type: "unknown",
    message: lastError?.message || "Unknown error",
    retryable: false,
  };
  return {
    ok: false,
    status: 0,
    statusText: "unknown",
    headers: new Headers(),
    data: errorData as T,
    duration,
  };
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  options: Omit<HttpRequestOptions, "method" | "body"> = {}
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });
}

export async function getJson<T = unknown>(
  url: string,
  options: Omit<HttpRequestOptions, "method" | "body"> = {}
): Promise<HttpResponse<T>> {
  return httpRequest<T>(url, {
    ...options,
    method: "GET",
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });
}

export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function buildUrl(base: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function measureDuration<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = Date.now();
  const result = await fn();
  return [result, Date.now() - start];
}
