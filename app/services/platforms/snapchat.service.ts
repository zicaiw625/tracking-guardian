

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  PlatformError,
} from "../../types";
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
import {
  classifyHttpError,
  classifyJsError,

} from "./base-platform.service";

const SNAPCHAT_API_BASE_URL = "https://tr.snapchat.com";

export interface SnapchatCredentials {
  pixelId: string;
  accessToken: string;
  testMode?: boolean;
}

const SNAPCHAT_EVENT_TYPES = {
  purchase: "PURCHASE",
  add_to_cart: "ADD_CART",
  view_content: "VIEW_CONTENT",
  page_view: "PAGE_VIEW",
  initiate_checkout: "START_CHECKOUT",
  add_payment_info: "ADD_BILLING",
  sign_up: "SIGN_UP",
  search: "SEARCH",
} as const;

export class SnapchatPlatformService implements IPlatformService {
  readonly platform = "snapchat" as const;
  readonly displayName = "Snapchat";

  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {
    const snapCreds = credentials as SnapchatCredentials;
    const validation = this.validateCredentials(snapCreds);

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
        this.sendRequest(snapCreds, data, dedupeEventId)
      );

      logger.info(`Snapchat CAPI: conversion sent successfully`, {
        orderId: data.orderId.slice(0, 8),
        eventId: dedupeEventId,
        durationMs: duration,
      });

      return {
        success: true,
        response,
        duration,
      };
    } catch (error) {
      const platformError = this.parseError(error);

      logger.error(`Snapchat CAPI: conversion failed`, {
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

    if (!creds.pixelId || typeof creds.pixelId !== "string") {
      errors.push("Snap Pixel ID is required");
    }

    if (!creds.accessToken || typeof creds.accessToken !== "string") {
      errors.push("Conversions API Token is required");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  parseError(error: unknown): PlatformError {
    if (error instanceof Error) {
      const attachedError = (error as Error & { platformError?: PlatformError }).platformError;
      if (attachedError) {
        return attachedError;
      }

      if (error.name === "AbortError") {
        return {
          type: "timeout",
          message: `Snapchat CAPI request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`,
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

    return {
      event_type: SNAPCHAT_EVENT_TYPES.purchase,
      event_conversion_type: "WEB",
      event_tag: eventId,
      timestamp: eventTime * 1000,

      price: data.value,
      currency: data.currency,
      transaction_id: data.orderId,
      number_items: data.lineItems?.reduce((sum, item) => sum + item.quantity, 0) || 1,
      item_ids: data.lineItems?.map(item => item.productId) || [],
    };
  }

  private async sendRequest(
    credentials: SnapchatCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<ConversionApiResponse> {
    const eventTime = Math.floor(Date.now() / 1000);

    const eventPayload = {
      pixel_id: credentials.pixelId,
      event_type: SNAPCHAT_EVENT_TYPES.purchase,
      event_conversion_type: "WEB",
      event_tag: eventId,
      timestamp: eventTime * 1000,

      price: data.value,
      currency: data.currency,
      transaction_id: data.orderId,
      number_items: data.lineItems?.reduce((sum, item) => sum + item.quantity, 0) || 1,
      item_ids: data.lineItems?.map(item => item.productId) || [],
    };

    const response = await fetchWithTimeout(
      SNAPCHAT_API_BASE_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${credentials.accessToken}`,
        },
        body: JSON.stringify(eventPayload),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const platformError = classifyHttpError(response.status, errorData);

      const enhancedError = new Error(`Snapchat API error: ${platformError.message}`) as Error & {
        platformError: PlatformError;
      };
      enhancedError.platformError = platformError;
      throw enhancedError;
    }

    const result = await response.json();

    return {
      success: true,
      conversionId: result.id,
      timestamp: new Date().toISOString(),
    };
  }
}

export const snapchatService = new SnapchatPlatformService();

export async function sendConversionToSnapchat(
  credentials: SnapchatCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.pixelId || !credentials?.accessToken) {
    throw new Error("Snapchat Pixel credentials not configured");
  }

  const result = await snapchatService.sendConversion(
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

