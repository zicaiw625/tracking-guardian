/**
 * Base Platform Service
 *
 * Abstract base class for platform CAPI services.
 * Provides common functionality and reduces code duplication across platforms.
 * 
 * This module consolidates all platform-related utilities including:
 * - HTTP request handling with timeout
 * - Error classification and parsing
 * - PII hashing utilities
 * - Retry logic helpers
 */

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  PlatformError,
  PlatformErrorType,
} from "../../types";
import type { PlatformType } from "../../types/enums";
import { logger } from "../../utils/logger.server";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto.server";
import {
  type IPlatformService,
  type PlatformSendResult,
  type CredentialsValidationResult,
  fetchWithTimeout,
  generateDedupeEventId,
  measureDuration,
  DEFAULT_API_TIMEOUT_MS,
} from "./interface";

// =============================================================================
// Error Classification Utilities
// =============================================================================

/**
 * Classify HTTP error by status code.
 */
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

/**
 * Classify JavaScript/network error.
 */
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

/**
 * Parse Meta API error response.
 */
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

/**
 * Parse Google Analytics error response.
 */
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

/**
 * Parse TikTok API error response.
 */
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

// =============================================================================
// Retry Logic Utilities
// =============================================================================

/**
 * Calculate exponential backoff delay with jitter.
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 300000
): number {
  const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.floor(exponentialDelay + jitter);
}

/**
 * Determine if error should be retried.
 */
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

/**
 * Format error for logging.
 */
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

// =============================================================================
// PII Hashing Utilities
// =============================================================================

/**
 * User data structure for Meta CAPI.
 */
export interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  country?: string[];
  zp?: string[];
}

/**
 * User data structure for TikTok Events API.
 */
export interface TikTokUserData {
  email?: string;
  phone_number?: string;
}

/**
 * PII quality assessment result.
 */
export type PiiQuality = "none" | "partial" | "good";

/**
 * Build hashed user data for Meta CAPI.
 * 
 * P1-2: 优先使用预哈希数据（来自 webhook handler），
 * 如果没有预哈希数据，则从原始 PII 字段中提取并哈希。
 */
export async function buildMetaHashedUserData(
  data: ConversionData
): Promise<{ userData: MetaUserData; piiQuality: PiiQuality }> {
  const userData: MetaUserData = {};
  const availableFields: string[] = [];

  // P1-2: 优先使用预哈希数据
  if (data.preHashedUserData) {
    const pre = data.preHashedUserData;
    
    if (pre.em) {
      userData.em = [pre.em];
      availableFields.push("email");
    }
    if (pre.ph) {
      userData.ph = [pre.ph];
      availableFields.push("phone");
    }
    if (pre.fn) {
      userData.fn = [pre.fn];
      availableFields.push("firstName");
    }
    if (pre.ln) {
      userData.ln = [pre.ln];
      availableFields.push("lastName");
    }
    if (pre.ct) {
      userData.ct = [pre.ct];
      availableFields.push("city");
    }
    if (pre.st) {
      userData.st = [pre.st];
      availableFields.push("state");
    }
    if (pre.country) {
      userData.country = [pre.country];
      availableFields.push("country");
    }
    if (pre.zp) {
      userData.zp = [pre.zp];
      availableFields.push("zip");
    }
    
    // 如果预哈希数据有任何字段，直接返回
    if (availableFields.length > 0) {
      let piiQuality: PiiQuality;
      if (availableFields.includes("email") || availableFields.includes("phone")) {
        piiQuality = "good";
      } else {
        piiQuality = "partial";
      }
      return { userData, piiQuality };
    }
  }

  // 回退：从原始 PII 字段中提取并哈希（兼容旧数据）
  if (data.email) {
    userData.em = [await hashValue(normalizeEmail(data.email))];
    availableFields.push("email");
  }

  if (data.phone) {
    userData.ph = [await hashValue(normalizePhone(data.phone))];
    availableFields.push("phone");
  }

  if (data.firstName) {
    const normalized = data.firstName.toLowerCase().trim();
    if (normalized) {
      userData.fn = [await hashValue(normalized)];
      availableFields.push("firstName");
    }
  }

  if (data.lastName) {
    const normalized = data.lastName.toLowerCase().trim();
    if (normalized) {
      userData.ln = [await hashValue(normalized)];
      availableFields.push("lastName");
    }
  }

  if (data.city) {
    const normalized = data.city.toLowerCase().replace(/\s/g, "");
    if (normalized) {
      userData.ct = [await hashValue(normalized)];
      availableFields.push("city");
    }
  }

  if (data.state) {
    const normalized = data.state.toLowerCase().trim();
    if (normalized) {
      userData.st = [await hashValue(normalized)];
      availableFields.push("state");
    }
  }

  if (data.country) {
    const normalized = data.country.toLowerCase().trim();
    if (normalized) {
      userData.country = [await hashValue(normalized)];
      availableFields.push("country");
    }
  }

  if (data.zip) {
    const normalized = data.zip.replace(/\s/g, "");
    if (normalized) {
      userData.zp = [await hashValue(normalized)];
      availableFields.push("zip");
    }
  }

  let piiQuality: PiiQuality;
  if (availableFields.length === 0) {
    piiQuality = "none";
  } else if (availableFields.includes("email") || availableFields.includes("phone")) {
    piiQuality = "good";
  } else {
    piiQuality = "partial";
  }

  return { userData, piiQuality };
}

/**
 * Build hashed user data for TikTok Events API.
 * 
 * P1-2: 优先使用预哈希数据，回退到从原始 PII 提取并哈希。
 */
export async function buildTikTokHashedUserData(
  data: ConversionData
): Promise<{ user: TikTokUserData; hasPii: boolean }> {
  const user: TikTokUserData = {};
  let hasPii = false;

  // P1-2: 优先使用预哈希数据
  if (data.preHashedUserData) {
    const pre = data.preHashedUserData;
    
    if (pre.em) {
      user.email = pre.em;
      hasPii = true;
    }
    if (pre.ph) {
      user.phone_number = pre.ph;
      hasPii = true;
    }
    
    if (hasPii) {
      return { user, hasPii };
    }
  }

  // 回退：从原始 PII 提取并哈希
  if (data.email) {
    user.email = await hashValue(normalizeEmail(data.email));
    hasPii = true;
  }

  if (data.phone) {
    user.phone_number = await hashValue(normalizePhone(data.phone));
    hasPii = true;
  }

  return { user, hasPii };
}

// =============================================================================
// Abstract Base Class
// =============================================================================

/**
 * Abstract base class for platform services.
 * Implements common patterns and reduces code duplication.
 */
export abstract class BasePlatformService implements IPlatformService {
  abstract readonly platform: PlatformType;
  abstract readonly displayName: string;

  /**
   * API endpoint URL
   */
  protected abstract readonly apiUrl: string;

  /**
   * API timeout in milliseconds
   */
  protected readonly timeoutMs: number = DEFAULT_API_TIMEOUT_MS;

  /**
   * Send a conversion event to the platform.
   * This template method handles common logic and delegates to subclasses.
   */
  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {
    // Validate credentials
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

  /**
   * Validate credentials format.
   * Subclasses should implement specific validation logic.
   */
  abstract validateCredentials(credentials: unknown): CredentialsValidationResult;

  /**
   * Parse platform-specific error into standardized format.
   * Subclasses should implement specific error parsing.
   */
  abstract parseError(error: unknown): PlatformError;

  /**
   * Build the platform-specific payload.
   */
  abstract buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>>;

  /**
   * Execute the HTTP request.
   * Subclasses can override for platform-specific request handling.
   */
  protected abstract executeRequest(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<ConversionApiResponse>;

  // ==========================================================================
  // Protected Helper Methods
  // ==========================================================================

  /**
   * Make an HTTP request with timeout.
   */
  protected async makeRequest(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    return fetchWithTimeout(url, options, this.timeoutMs);
  }

  /**
   * Classify HTTP error by status code.
   */
  protected classifyHttpError(
    statusCode: number,
    message: string
  ): PlatformError {
    return classifyHttpError(statusCode, message);
  }

  /**
   * Handle timeout errors.
   */
  protected createTimeoutError(): PlatformError {
    return {
      type: "timeout",
      message: `${this.displayName} request timeout after ${this.timeoutMs}ms`,
      isRetryable: true,
    };
  }

  /**
   * Log successful conversion.
   */
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

  /**
   * Log conversion error.
   */
  protected logError(orderId: string, error: PlatformError): void {
    logger.error(`${this.displayName}: conversion failed`, {
      platform: this.platform,
      orderId: orderId.slice(0, 8),
      error: error.message,
      type: error.type,
      isRetryable: error.isRetryable,
    });
  }

  // ==========================================================================
  // Validation Helpers
  // ==========================================================================

  /**
   * Validate required string field.
   */
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

  /**
   * Validate field matches pattern.
   */
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

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Options for creating a platform service
 */
export interface PlatformServiceOptions {
  timeoutMs?: number;
}

/**
 * Result of a batch send operation
 */
export interface BatchSendResult {
  results: Record<string, PlatformSendResult>;
  totalSucceeded: number;
  totalFailed: number;
  duration: number;
}

// =============================================================================
// Batch Send Helper
// =============================================================================

/**
 * Send conversion to multiple platforms in parallel.
 */
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
