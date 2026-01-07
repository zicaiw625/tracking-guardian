

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  PlatformError,
  PlatformErrorType,
} from "../../types";
import type { PlatformType } from "~/types/enums";
import { logger } from "~/utils/logger.server";

import {
  type IPlatformService,
  type PlatformSendResult,
  type CredentialsValidationResult,
  fetchWithTimeout,
  generateDedupeEventId,
  measureDuration,
  DEFAULT_API_TIMEOUT_MS,
} from "./interface";

export function classifyHttpError(status: number, body?: unknown): PlatformError {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body || {});

  switch (true) {
    case status === 401:
      return {
        type: "auth_error",
        message: "Invalid or expired access token",
        isRetryable: false,
        platformCode: String(status),
      };
    case status === 403:
      return {
        type: "auth_error",
        message: "Access denied - check permissions",
        isRetryable: false,
        platformCode: String(status),
      };
    case status === 400:
      return {
        type: "validation_error",
        message: "Invalid request data",
        isRetryable: false,
        platformCode: String(status),
        platformMessage: bodyStr.slice(0, 500),
      };
    case status === 429:
      return {
        type: "rate_limited",
        message: "Rate limit exceeded",
        isRetryable: true,
        platformCode: String(status),
        retryAfter: 60,
      };
    case status >= 500 && status < 600:
      return {
        type: "server_error",
        message: `Platform server error (${status})`,
        isRetryable: true,
        platformCode: String(status),
      };
    default:
      return {
        type: "unknown",
        message: `Unexpected status code: ${status}`,
        isRetryable: true,
        platformCode: String(status),
      };
  }
}

export function classifyJsError(error: Error): PlatformError {
  const message = error.message.toLowerCase();

  if (message.includes("timeout") || message.includes("aborted") || error.name === "AbortError") {
    return {
      type: "timeout",
      message: "Request timeout",
      isRetryable: true,
    };
  }

  if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
    return {
      type: "network_error",
      message: "Network error",
      isRetryable: true,
    };
  }

  return {
    type: "unknown",
    message: error.message,
    isRetryable: true,
  };
}

export function parseMetaError(response: unknown): PlatformError {
  const data = response as {
    error?: {
      message?: string;
      code?: number;
      fbtrace_id?: string;
    };
  };

  const error = data?.error;
  if (!error) {
    return {
      type: "unknown",
      message: "Unknown Meta API error",
      isRetryable: true,
    };
  }

  const code = error.code;
  const message = error.message || "Unknown error";
  const traceId = error.fbtrace_id;

  switch (true) {
    case code === 190:
    case code === 102:
      return {
        type: "auth_error",
        message: "Access token expired or invalid",
        isRetryable: false,
        platformCode: String(code),
        platformMessage: message,
        traceId,
      };
    case code === 100:
    case code === 803:
      return {
        type: "invalid_config",
        message: "Invalid Pixel ID or parameter",
        isRetryable: false,
        platformCode: String(code),
        platformMessage: message,
        traceId,
      };
    case code === 4 || code === 17:
      return {
        type: "rate_limited",
        message: "Meta API rate limit exceeded",
        isRetryable: true,
        platformCode: String(code),
        platformMessage: message,
        traceId,
        retryAfter: 60,
      };
    case code === 1 || code === 2:
      return {
        type: "server_error",
        message: "Meta API service error",
        isRetryable: true,
        platformCode: String(code),
        platformMessage: message,
        traceId,
      };
    default:
      return {
        type: "unknown",
        message,
        isRetryable: true,
        platformCode: String(code),
        traceId,
      };
  }
}

export function parseGoogleError(response: unknown): PlatformError {
  const data = response as {
    validationMessages?: Array<{
      description?: string;
      validationCode?: string;
    }>;
  };

  const messages = data?.validationMessages;
  if (!messages || messages.length === 0) {
    return {
      type: "unknown",
      message: "Unknown Google Analytics error",
      isRetryable: true,
    };
  }

  const firstError = messages[0];
  const code = firstError.validationCode || "UNKNOWN";
  const message = firstError.description || "Validation error";

  switch (code) {
    case "INVALID_API_SECRET":
    case "INVALID_MEASUREMENT_ID":
      return {
        type: "auth_error",
        message: "Invalid API secret or Measurement ID",
        isRetryable: false,
        platformCode: code,
        platformMessage: message,
      };
    case "INVALID_EVENT_NAME":
    case "INVALID_PARAMETER":
      return {
        type: "validation_error",
        message: "Invalid event data",
        isRetryable: false,
        platformCode: code,
        platformMessage: message,
      };
    default:
      return {
        type: "unknown",
        message,
        isRetryable: true,
        platformCode: code,
      };
  }
}

export function parseTikTokError(response: unknown): PlatformError {
  const data = response as {
    code?: number;
    message?: string;
  };

  const code = data?.code;
  const message = data?.message || "Unknown error";

  switch (true) {
    case code === 40001:
    case code === 40002:
      return {
        type: "auth_error",
        message: "Access token invalid or expired",
        isRetryable: false,
        platformCode: String(code),
        platformMessage: message,
      };
    case code === 40100:
      return {
        type: "invalid_config",
        message: "Invalid Pixel ID",
        isRetryable: false,
        platformCode: String(code),
        platformMessage: message,
      };
    case code === 40300:
      return {
        type: "validation_error",
        message: "Invalid event data",
        isRetryable: false,
        platformCode: String(code),
        platformMessage: message,
      };
    case code === 42900:
      return {
        type: "rate_limited",
        message: "TikTok API rate limit exceeded",
        isRetryable: true,
        platformCode: String(code),
        platformMessage: message,
        retryAfter: 60,
      };
    case code && code >= 50000:
      return {
        type: "server_error",
        message: "TikTok server error",
        isRetryable: true,
        platformCode: String(code),
        platformMessage: message,
      };
    default:
      return {
        type: "unknown",
        message,
        isRetryable: true,
        platformCode: String(code),
      };
  }
}

export function calculateBackoff(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 300000
): number {
  const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.floor(exponentialDelay + jitter);
}

export function shouldRetry(
  error: PlatformError,
  currentAttempt: number,
  maxAttempts: number
): boolean {
  if (currentAttempt >= maxAttempts) {
    return false;
  }
  return error.isRetryable;
}

export function formatErrorForLog(error: PlatformError): Record<string, unknown> {
  return {
    type: error.type,
    message: error.message,
    isRetryable: error.isRetryable,
    platformCode: error.platformCode,
    platformMessage: error.platformMessage?.slice(0, 200),
    traceId: error.traceId,
    retryAfter: error.retryAfter,
  };
}

export abstract class BasePlatformService implements IPlatformService {
  abstract readonly platform: PlatformType;
  abstract readonly displayName: string;

  protected abstract readonly apiUrl: string;

  protected readonly timeoutMs: number = DEFAULT_API_TIMEOUT_MS;

  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {

    const validation = this.validateCredentials(credentials);

    if (!validation.valid) {
      return {
        success: false,
        error: {
          type: "invalid_config",
          message: validation.errors.join("; "),
          isRetryable: false,
        },
      };
    }

    const dedupeEventId = eventId || generateDedupeEventId(data.orderId);

    try {
      const [response, duration] = await measureDuration(() =>
        this.executeRequest(credentials, data, dedupeEventId)
      );

      this.logSuccess(data.orderId, dedupeEventId, duration, response);

      return {
        success: true,
        response,
        duration,
      };
    } catch (error) {
      const platformError = this.parseError(error);

      this.logError(data.orderId, platformError);

      return {
        success: false,
        error: platformError,
      };
    }
  }

  abstract validateCredentials(credentials: unknown): CredentialsValidationResult;

  abstract parseError(error: unknown): PlatformError;

  abstract buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>>;

  protected abstract executeRequest(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<ConversionApiResponse>;

  protected async makeRequest(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    return fetchWithTimeout(url, options, this.timeoutMs);
  }

  protected classifyHttpError(
    statusCode: number,
    message: string
  ): PlatformError {
    return classifyHttpError(statusCode, message);
  }

  protected createTimeoutError(): PlatformError {
    return {
      type: "timeout",
      message: `${this.displayName} request timeout after ${this.timeoutMs}ms`,
      isRetryable: true,
    };
  }

  protected logSuccess(
    orderId: string,
    eventId: string,
    durationMs: number,
    response?: ConversionApiResponse
  ): void {
    logger.info(`${this.displayName}: conversion sent successfully`, {
      platform: this.platform,
      orderId: orderId.slice(0, 8),
      eventId,
      durationMs,
      ...(response?.events_received && { eventsReceived: response.events_received }),
    });
  }

  protected logError(orderId: string, error: PlatformError): void {
    logger.error(`${this.displayName}: conversion failed`, {
      platform: this.platform,
      orderId: orderId.slice(0, 8),
      error: error.message,
      type: error.type,
      isRetryable: error.isRetryable,
    });
  }

  protected validateRequired(
    credentials: Record<string, unknown>,
    field: string,
    errors: string[]
  ): boolean {
    if (!credentials[field] || typeof credentials[field] !== "string") {
      errors.push(`${field} is required`);
      return false;
    }
    return true;
  }

  protected validatePattern(
    value: string,
    pattern: RegExp,
    fieldName: string,
    formatDescription: string,
    errors: string[]
  ): boolean {
    if (!pattern.test(value)) {
      errors.push(`Invalid ${fieldName} format: ${value}. ${formatDescription}`);
      return false;
    }
    return true;
  }
}

export interface PlatformServiceOptions {
  timeoutMs?: number;
}

export interface BatchSendResult {
  results: Record<string, PlatformSendResult>;
  totalSucceeded: number;
  totalFailed: number;
  duration: number;
}

export async function sendToMultiplePlatforms(
  platforms: Array<{
    service: IPlatformService;
    credentials: PlatformCredentials;
  }>,
  data: ConversionData,
  eventId: string
): Promise<BatchSendResult> {
  const startTime = Date.now();
  const results: Record<string, PlatformSendResult> = {};
  let totalSucceeded = 0;
  let totalFailed = 0;

  const promises = platforms.map(async ({ service, credentials }) => {
    try {
      const result = await service.sendConversion(credentials, data, eventId);
      results[service.platform] = result;

      if (result.success) {
        totalSucceeded++;
      } else {
        totalFailed++;
      }
    } catch (error) {
      results[service.platform] = {
        success: false,
        error: {
          type: "unknown",
          message: error instanceof Error ? error.message : String(error),
          isRetryable: true,
        },
      };
      totalFailed++;
    }
  });

  await Promise.all(promises);

  return {
    results,
    totalSucceeded,
    totalFailed,
    duration: Date.now() - startTime,
  };
}
