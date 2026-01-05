

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  PlatformError,
  PlatformErrorType,
} from "../../types";
import type { PlatformType } from "~/types/enums";
import { logger } from "~/utils/logger.server";
import { hashValue, normalizePhone, normalizeEmail } from "~/utils/crypto.server";

export const hashSHA256 = hashValue;
export const hashUserData = hashValue;
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

export interface TikTokUserData {
  email?: string;
  phone_number?: string;
}

export type PiiQuality = "none" | "partial" | "good";

/**
 * P0-1: v1.0 版本不处理任何 PCD/PII 数据（包括哈希后的数据）
 * 
 * 上架前审查要求：
 * - v1.0 必须完全避免 PCD (Protected Customer Data) 合规复杂性
 * - 即使收到 preHashedUserData 或 email/phone 字段，也返回空的 userData
 * - 所有 PII 处理逻辑已通过 `if (false)` 禁用，确保不会执行
 * - 此函数在 v1.0 中仅作为占位符存在，将在 v1.1 中重新启用（需通过 PCD 审核）
 * 
 * 安全说明：
 * - 哈希后的 PII 仍然被视为客户数据处理的一部分
 * - v1.0 策略：完全不处理任何形式的 PII，包括哈希值
 * - 这确保 v1.0 符合 Shopify App Store 审核要求，避免 PCD 合规复杂性
 */
export async function buildMetaHashedUserData(
  data: ConversionData
): Promise<{ userData: MetaUserData; piiQuality: PiiQuality }> {
  // P0-1: v1.0 版本不处理任何 PII 数据（包括哈希后的数据）
  // 即使收到 preHashedUserData 或 email/phone 字段，在 v1.0 中也返回空的 userData
  // 这确保 v1.0 符合 Shopify App Store 审核要求，避免 PCD 合规复杂性
  const userData: MetaUserData = {};
  const availableFields: string[] = [];

  // v1.0: 跳过所有 PII 处理，直接返回空 userData
  // 在 v1.1+ 中，当 PCD 审核通过后，可以重新启用此功能
  if (false && data.preHashedUserData) {
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

  // v1.0: 跳过所有原始 PII 字段的处理
  // 在 v1.1+ 中，当 PCD 审核通过后，可以重新启用此功能
  if (false) {
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
 * P0-1: v1.0 版本不处理任何 PCD/PII 数据（包括哈希后的数据）
 * 
 * 上架前审查要求：
 * - v1.0 必须完全避免 PCD (Protected Customer Data) 合规复杂性
 * - 即使收到 preHashedUserData 或 email/phone 字段，也返回空的 user 对象
 * - 所有 PII 处理逻辑已通过 `if (false)` 禁用，确保不会执行
 * - 此函数在 v1.0 中仅作为占位符存在，将在 v1.1 中重新启用（需通过 PCD 审核）
 * 
 * 安全说明：
 * - 哈希后的 PII 仍然被视为客户数据处理的一部分
 * - v1.0 策略：完全不处理任何形式的 PII，包括哈希值
 * - 这确保 v1.0 符合 Shopify App Store 审核要求，避免 PCD 合规复杂性
 */
export async function buildTikTokHashedUserData(
  data: ConversionData
): Promise<{ user: TikTokUserData; hasPii: boolean }> {
  // P0-1: v1.0 版本不处理任何 PII 数据（包括哈希后的数据）
  // 即使收到 preHashedUserData 或 email/phone 字段，在 v1.0 中也返回空的 user 对象
  // 这确保 v1.0 符合 Shopify App Store 审核要求，避免 PCD 合规复杂性
  const user: TikTokUserData = {};
  const hasPii = false; // v1.0: 强制设置为 false，确保不会处理任何 PII

  // v1.0: 跳过所有 PII 处理，直接返回空 user 对象
  // 在 v1.1+ 中，当 PCD 审核通过后，可以重新启用此功能
  if (false) {
    if (data.preHashedUserData) {
      const pre = data.preHashedUserData;

      if (pre.em) {
        user.email = pre.em;
        // hasPii = true; // v1.0: 已禁用
      }
      if (pre.ph) {
        user.phone_number = pre.ph;
        // hasPii = true; // v1.0: 已禁用
      }
    }

    if (data.email) {
      user.email = await hashValue(normalizeEmail(data.email));
      // hasPii = true; // v1.0: 已禁用
    }

    if (data.phone) {
      user.phone_number = await hashValue(normalizePhone(data.phone));
      // hasPii = true; // v1.0: 已禁用
    }
  }

  return { user, hasPii };
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
