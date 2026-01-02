

import { logger } from "./logger.server";

export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_RETRY_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;

export interface HttpRequestOptions extends RequestInit {

  timeout?: number;

  retries?: number;

  baseDelayMs?: number;

  maxDelayMs?: number;

  retryOn?: Array<"timeout" | "network" | "5xx" | "429">;
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

export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    retries = 0,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    retryOn = ["timeout", "network", "5xx"],
    ...fetchOptions
  } = options;

  let lastError: Error | undefined;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, fetchOptions, timeout);
      const duration = Date.now() - startTime;

      if (!response.ok && isRetryableStatus(response.status, retryOn) && attempt < retries) {
        const retryAfter = extractRetryAfter(response) || calculateBackoffDelay(attempt + 1, baseDelayMs, maxDelayMs);
        logger.debug(`HTTP ${response.status} from ${url}, retrying in ${retryAfter}ms`, {
          attempt: attempt + 1,
          maxAttempts: retries + 1,
        });
        await sleep(retryAfter);
        continue;
      }

      let data: T;
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        data = await response.json() as T;
      } else {
        const text = await response.text();
        // 对于非JSON响应，如果T是string类型则返回文本，否则返回错误对象
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
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const duration = Date.now() - startTime;

      const isTimeout = lastError.name === "AbortError";
      const isNetwork = lastError.message.includes("fetch") || lastError.message.includes("network");
      const shouldRetry =
        attempt < retries &&
        ((isTimeout && retryOn.includes("timeout")) || (isNetwork && retryOn.includes("network")));

      if (shouldRetry) {
        const delay = calculateBackoffDelay(attempt + 1, baseDelayMs, maxDelayMs);
        logger.debug(`HTTP error: ${lastError.message}, retrying in ${delay}ms`, {
          url,
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
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
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

