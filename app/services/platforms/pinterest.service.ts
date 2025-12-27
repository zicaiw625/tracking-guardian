/**
 * Pinterest Conversions API Service
 * 对应设计方案 4.3 像素迁移中心 - Pinterest 支持
 *
 * Pinterest API 文档: https://developers.pinterest.com/docs/api/v5/#tag/conversion_events
 */

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  PlatformError,
} from "../../types";
import { Platform } from "../../types/enums";
import { logger } from "../../utils/logger.server";
import {
  type IPlatformService,
  type PlatformSendResult,
  type CredentialsValidationResult,
  fetchWithTimeout,
  generateDedupeEventId,
  measureDuration,
  DEFAULT_API_TIMEOUT_MS,
} from "./interface";
import { classifyHttpError, classifyJsError, hashSHA256 } from "./base-platform.service";

// Pinterest API 配置
const PINTEREST_API_VERSION = "v5";
const PINTEREST_API_BASE_URL = "https://api.pinterest.com";

// Pinterest 凭证类型
export interface PinterestCredentials extends PlatformCredentials {
  adAccountId: string; // Pinterest Ad Account ID
  accessToken: string; // Pinterest API Access Token
  testMode?: boolean; // 是否使用测试模式
}

// Pinterest 事件类型
type PinterestEventType =
  | "checkout"
  | "add_to_cart"
  | "page_visit"
  | "signup"
  | "watch_video"
  | "lead"
  | "search"
  | "view_category"
  | "custom";

// Pinterest 用户数据
interface PinterestUserData {
  em?: string[]; // Hashed email (SHA256)
  ph?: string[]; // Hashed phone (SHA256)
  ge?: string[]; // Gender
  bd?: string[]; // Birth date
  ln?: string[]; // Hashed last name
  fn?: string[]; // Hashed first name
  ct?: string[]; // City
  st?: string[]; // State
  zp?: string[]; // Zip code
  country?: string[]; // Country
  external_id?: string[]; // External customer ID
  click_id?: string; // Pinterest click ID
  partner_id?: string; // Partner ID
}

// Pinterest 自定义数据
interface PinterestCustomData {
  currency?: string;
  value?: string;
  content_ids?: string[];
  contents?: Array<{
    id?: string;
    item_price?: string;
    quantity?: number;
  }>;
  num_items?: number;
  order_id?: string;
  search_string?: string;
  opt_out_type?: string;
  np?: string; // Named partner
}

// Pinterest 事件数据
interface PinterestEventData {
  event_name: PinterestEventType;
  action_source: "app_android" | "app_ios" | "web" | "offline";
  event_time: number;
  event_id: string;
  event_source_url?: string;
  partner_name?: string;
  user_data: PinterestUserData;
  custom_data?: PinterestCustomData;
  app_id?: string;
  app_name?: string;
  app_version?: string;
  device_brand?: string;
  device_carrier?: string;
  device_model?: string;
  device_type?: string;
  os_version?: string;
  wifi?: boolean;
  language?: string;
}

// Pinterest API 响应
interface PinterestApiResponse {
  num_events_received: number;
  num_events_processed: number;
  events?: Array<{
    status: "processed" | "failed";
    error_message?: string;
    warning_message?: string;
  }>;
}

export class PinterestPlatformService implements IPlatformService {
  readonly platform = Platform.PINTEREST;
  readonly displayName = "Pinterest";

  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {
    const pinterestCreds = credentials as PinterestCredentials;
    const validation = this.validateCredentials(pinterestCreds);

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
        this.sendRequest(pinterestCreds, data, dedupeEventId)
      );

      logger.info(`Pinterest CAPI: conversion sent successfully`, {
        orderId: data.orderId.slice(0, 8),
        eventId: dedupeEventId,
        eventsProcessed: response.num_events_processed,
        durationMs: duration,
      });

      return {
        success: true,
        response: {
          success: true,
          events_received: response.num_events_received,
          events_processed: response.num_events_processed,
          timestamp: new Date().toISOString(),
        },
        duration,
      };
    } catch (error) {
      const platformError = this.parseError(error);

      logger.error(`Pinterest CAPI: conversion failed`, {
        orderId: data.orderId.slice(0, 8),
        error: platformError.message,
        type: platformError.type,
      });

      return {
        success: false,
        error: platformError,
      };
    }
  }

  validateCredentials(credentials: unknown): CredentialsValidationResult {
    const errors: string[] = [];

    if (!credentials || typeof credentials !== "object") {
      return { valid: false, errors: ["Credentials must be an object"] };
    }

    const creds = credentials as Record<string, unknown>;

    // 验证 Ad Account ID
    if (!creds.adAccountId || typeof creds.adAccountId !== "string") {
      errors.push("adAccountId is required");
    } else if (!/^\d+$/.test(creds.adAccountId)) {
      errors.push(`Invalid Pinterest Ad Account ID format: ${creds.adAccountId}. Expected numeric ID.`);
    }

    // 验证 Access Token
    if (!creds.accessToken || typeof creds.accessToken !== "string") {
      errors.push("accessToken is required");
    } else if (creds.accessToken.length < 10) {
      errors.push("accessToken appears to be invalid (too short)");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  parseError(error: unknown): PlatformError {
    if (error instanceof Error) {
      // 检查是否有附加的平台错误
      const attachedError = (error as Error & { platformError?: PlatformError }).platformError;
      if (attachedError) {
        return attachedError;
      }

      if (error.name === "AbortError") {
        return {
          type: "timeout",
          message: `Pinterest CAPI request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`,
          isRetryable: true,
        };
      }

      return classifyJsError(error);
    }

    return {
      type: "unknown",
      message: String(error),
      isRetryable: true,
    };
  }

  async buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>> {
    const eventTime = Math.floor(Date.now() / 1000);
    const userData = await this.buildUserData(data);

    const contents =
      data.lineItems?.map((item) => ({
        id: item.productId,
        item_price: item.price.toString(),
        quantity: item.quantity,
      })) || [];

    const eventData: PinterestEventData = {
      event_name: "checkout",
      action_source: "web",
      event_time: eventTime,
      event_id: eventId,
      user_data: userData,
      custom_data: {
        currency: data.currency,
        value: data.value.toString(),
        order_id: data.orderId,
        contents,
        num_items: contents.reduce((sum, c) => sum + (c.quantity || 1), 0),
      },
    };

    return { data: [eventData] };
  }

  private async buildUserData(data: ConversionData): Promise<PinterestUserData> {
    const userData: PinterestUserData = {};

    // Pinterest 需要 SHA256 哈希的用户数据
    if (data.customerEmail) {
      const normalizedEmail = data.customerEmail.toLowerCase().trim();
      userData.em = [await hashSHA256(normalizedEmail)];
    }

    if (data.customerPhone) {
      // 移除非数字字符
      const normalizedPhone = data.customerPhone.replace(/\D/g, "");
      if (normalizedPhone.length >= 10) {
        userData.ph = [await hashSHA256(normalizedPhone)];
      }
    }

    // 如果有客户 ID，作为 external_id
    if (data.customerId) {
      userData.external_id = [data.customerId];
    }

    return userData;
  }

  private async sendRequest(
    credentials: PinterestCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PinterestApiResponse> {
    const eventTime = Math.floor(Date.now() / 1000);
    const userData = await this.buildUserData(data);

    const contents =
      data.lineItems?.map((item) => ({
        id: item.productId,
        item_price: item.price.toString(),
        quantity: item.quantity,
      })) || [];

    const eventData: PinterestEventData = {
      event_name: "checkout",
      action_source: "web",
      event_time: eventTime,
      event_id: eventId,
      user_data: userData,
      custom_data: {
        currency: data.currency,
        value: data.value.toString(),
        order_id: data.orderId,
        contents,
        num_items: contents.reduce((sum, c) => sum + (c.quantity || 1), 0),
      },
    };

    const url = `${PINTEREST_API_BASE_URL}/${PINTEREST_API_VERSION}/ad_accounts/${credentials.adAccountId}/events`;

    const requestBody = {
      data: [eventData],
    };

    // 如果是测试模式，添加测试标记
    if (credentials.testMode) {
      logger.info(`Pinterest CAPI: sending in test mode`, {
        orderId: data.orderId.slice(0, 8),
      });
    }

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.accessToken}`,
        },
        body: JSON.stringify(requestBody),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const platformError = this.parsePinterestError(response.status, errorData);

      const enhancedError = new Error(`Pinterest API error: ${platformError.message}`) as Error & {
        platformError: PlatformError;
      };
      enhancedError.platformError = platformError;
      throw enhancedError;
    }

    const result: PinterestApiResponse = await response.json();

    // 检查事件级别的错误
    if (result.events && result.events.length > 0) {
      const failedEvents = result.events.filter((e) => e.status === "failed");
      if (failedEvents.length > 0) {
        logger.warn(`Pinterest CAPI: some events failed`, {
          orderId: data.orderId.slice(0, 8),
          failedCount: failedEvents.length,
          errors: failedEvents.map((e) => e.error_message).filter(Boolean),
        });
      }

      const warningEvents = result.events.filter((e) => e.warning_message);
      if (warningEvents.length > 0) {
        logger.info(`Pinterest CAPI: events with warnings`, {
          orderId: data.orderId.slice(0, 8),
          warnings: warningEvents.map((e) => e.warning_message).filter(Boolean),
        });
      }
    }

    return result;
  }

  private parsePinterestError(
    statusCode: number,
    errorData: Record<string, unknown>
  ): PlatformError {
    // Pinterest 特定错误处理
    const code = errorData.code as number | undefined;
    const message = (errorData.message as string) || `HTTP ${statusCode}`;

    // Pinterest 错误代码映射
    // 参考: https://developers.pinterest.com/docs/api/v5/#section/Error-handling
    switch (code) {
      case 1:
        return {
          type: "invalid_config",
          message: `Invalid parameter: ${message}`,
          isRetryable: false,
        };
      case 2:
        return {
          type: "auth_error",
          message: `Authentication error: ${message}`,
          isRetryable: false,
        };
      case 3:
        return {
          type: "rate_limit",
          message: `Rate limit exceeded: ${message}`,
          isRetryable: true,
          retryAfterMs: 60000, // 1 分钟后重试
        };
      case 4:
        return {
          type: "invalid_config",
          message: `Access denied: ${message}`,
          isRetryable: false,
        };
      case 5:
        return {
          type: "api_error",
          message: `Resource not found: ${message}`,
          isRetryable: false,
        };
      default:
        return classifyHttpError(statusCode, errorData);
    }
  }
}

// 单例服务实例
export const pinterestService = new PinterestPlatformService();

/**
 * 发送转化到 Pinterest (兼容旧接口)
 */
export async function sendConversionToPinterest(
  credentials: PinterestCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.adAccountId || !credentials?.accessToken) {
    throw new Error("Pinterest credentials not configured");
  }

  const result = await pinterestService.sendConversion(
    credentials,
    conversionData,
    eventId || generateDedupeEventId(conversionData.orderId)
  );

  if (!result.success) {
    const enhancedError = new Error(result.error?.message || "Unknown error") as Error & {
      platformError?: PlatformError;
    };
    enhancedError.platformError = result.error;
    throw enhancedError;
  }

  return result.response!;
}

/**
 * 验证 Pinterest 凭证
 */
export async function validatePinterestCredentials(
  credentials: PinterestCredentials
): Promise<{ valid: boolean; error?: string }> {
  try {
    // 调用 Pinterest API 验证凭证
    const url = `${PINTEREST_API_BASE_URL}/${PINTEREST_API_VERSION}/ad_accounts/${credentials.adAccountId}`;

    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
        },
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (response.ok) {
      return { valid: true };
    }

    const errorData = await response.json().catch(() => ({}));
    const message = (errorData.message as string) || `HTTP ${response.status}`;

    return {
      valid: false,
      error: `Pinterest API validation failed: ${message}`,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error validating credentials",
    };
  }
}

