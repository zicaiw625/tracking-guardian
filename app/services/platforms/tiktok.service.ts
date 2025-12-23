/**
 * TikTok Events API Service
 *
 * Implements the IPlatformService interface for TikTok CAPI.
 */

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  TikTokCredentials,
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
import {
  classifyJsError,
  parseTikTokError,
  buildTikTokHashedUserData,
  type TikTokUserData,
} from "./base-platform.service";

// =============================================================================
// Constants
// =============================================================================

const TIKTOK_API_URL = "https://business-api.tiktok.com/open_api/v1.3/pixel/track/";
const PIXEL_ID_PATTERN = /^[A-Z0-9]{20,}$/i;

// =============================================================================
// TikTok Platform Service
// =============================================================================

/**
 * TikTok Events API service implementation.
 */
export class TikTokPlatformService implements IPlatformService {
  readonly platform = Platform.TIKTOK;
  readonly displayName = "TikTok";

  /**
   * Send a conversion event to TikTok via Events API.
   */
  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {
    const tiktokCreds = credentials as TikTokCredentials;
    const validation = this.validateCredentials(tiktokCreds);

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
        this.sendRequest(tiktokCreds, data, dedupeEventId)
      );

      logger.info(`TikTok Events API: conversion sent successfully`, {
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

      logger.error(`TikTok Events API: conversion failed`, {
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

  /**
   * Validate TikTok credentials format.
   */
  validateCredentials(credentials: unknown): CredentialsValidationResult {
    const errors: string[] = [];

    if (!credentials || typeof credentials !== "object") {
      return { valid: false, errors: ["Credentials must be an object"] };
    }

    const creds = credentials as Record<string, unknown>;

    if (!creds.pixelId || typeof creds.pixelId !== "string") {
      errors.push("pixelId is required");
    } else if (!PIXEL_ID_PATTERN.test(creds.pixelId)) {
      errors.push(
        `Invalid TikTok Pixel ID format: ${creds.pixelId}. Expected 20+ alphanumeric characters.`
      );
    }

    if (!creds.accessToken || typeof creds.accessToken !== "string") {
      errors.push("accessToken is required");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Parse TikTok-specific error into standardized format.
   */
  parseError(error: unknown): PlatformError {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          type: "timeout",
          message: `TikTok Events API request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`,
          isRetryable: true,
        };
      }

      // Parse TikTok API errors
      const apiMatch = error.message.match(/TikTok API error:\s*(.+)/);
      if (apiMatch) {
        return this.classifyTikTokError(apiMatch[1]);
      }

      return classifyJsError(error);
    }

    return {
      type: "unknown",
      message: String(error),
      isRetryable: true,
    };
  }

  /**
   * Build the TikTok Events API payload.
   */
  async buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>> {
    const timestamp = new Date().toISOString();
    const { user } = await buildTikTokHashedUserData(data);

    const contents =
      data.lineItems?.map((item) => ({
        content_id: item.productId,
        content_name: item.name,
        quantity: item.quantity,
        price: item.price,
      })) || [];

    return {
      event: "CompletePayment",
      event_id: eventId,
      timestamp,
      context: {
        user,
      },
      properties: {
        currency: data.currency,
        value: data.value,
        order_id: data.orderId,
        contents,
        content_type: "product",
      },
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Send the actual HTTP request to TikTok.
   */
  private async sendRequest(
    credentials: TikTokCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<ConversionApiResponse> {
    const timestamp = new Date().toISOString();
    const { user, hasPii } = await buildTikTokHashedUserData(data);

    if (!hasPii) {
      logger.info(`TikTok Events API: Sending conversion with no PII`, {
        orderId: data.orderId.slice(0, 8),
        note: "Conversion will still be recorded but may have lower match rate",
      });
    }

    const contents =
      data.lineItems?.map((item) => ({
        content_id: item.productId,
        content_name: item.name,
        quantity: item.quantity,
        price: item.price,
      })) || [];

    const eventPayload = {
      pixel_code: credentials.pixelId,
      event: "CompletePayment",
      event_id: eventId,
      timestamp,
      context: {
        user,
      },
      properties: {
        currency: data.currency,
        value: data.value,
        order_id: data.orderId,
        contents,
        content_type: "product",
      },
      ...(credentials.testEventCode && { test_event_code: credentials.testEventCode }),
    };

    const response = await fetchWithTimeout(
      TIKTOK_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": credentials.accessToken,
        },
        body: JSON.stringify({ data: [eventPayload] }),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || "Unknown TikTok API error";
      throw new Error(`TikTok API error: ${errorMessage}`);
    }

    const result = await response.json();

    return {
      success: true,
      conversionId: data.orderId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Classify TikTok API error message.
   */
  private classifyTikTokError(message: string): PlatformError {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("unauthorized") || lowerMessage.includes("invalid token")) {
      return {
        type: "auth_error",
        message: "TikTok authentication failed. Check your access token.",
        isRetryable: false,
      };
    }

    if (lowerMessage.includes("rate limit")) {
      return {
        type: "rate_limited",
        message: "TikTok rate limit exceeded",
        isRetryable: true,
        retryAfter: 60,
      };
    }

    if (lowerMessage.includes("invalid pixel")) {
      return {
        type: "invalid_config",
        message: "Invalid TikTok Pixel ID",
        isRetryable: false,
      };
    }

    return {
      type: "unknown",
      message,
      isRetryable: true,
    };
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Singleton instance of TikTok platform service.
 */
export const tiktokService = new TikTokPlatformService();

// =============================================================================
// Legacy Export (Backwards Compatibility)
// =============================================================================

/**
 * Send conversion to TikTok.
 *
 * @deprecated Use tiktokService.sendConversion() instead
 */
export async function sendConversionToTikTok(
  credentials: TikTokCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.pixelId || !credentials?.accessToken) {
    throw new Error("TikTok Pixel credentials not configured");
  }

  const result = await tiktokService.sendConversion(
    credentials,
    conversionData,
    eventId || generateDedupeEventId(conversionData.orderId)
  );

  if (!result.success) {
    throw new Error(result.error?.message || "Unknown error");
  }

  return result.response!;
}

/**
 * @deprecated Client-side code generation removed
 */
export function generateTikTokPixelCode(_config: { pixelId: string }): string {
  return "";
}
