/**
 * Google Analytics 4 Measurement Protocol Service
 *
 * Implements the IPlatformService interface for Google GA4 CAPI.
 */

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  GoogleCredentials,
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
  BasePlatformService,
  classifyHttpError,
  classifyJsError,
  parseGoogleError,
} from "./base-platform.service";

// =============================================================================
// Constants
// =============================================================================

const GA4_MEASUREMENT_PROTOCOL_URL = "https://www.google-analytics.com/mp/collect";
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;

// =============================================================================
// Google Platform Service
// =============================================================================

/**
 * Google Analytics 4 Measurement Protocol service implementation.
 */
export class GooglePlatformService implements IPlatformService {
  readonly platform = Platform.GOOGLE;
  readonly displayName = "Google Ads / GA4";

  /**
   * Send a conversion event to GA4 via Measurement Protocol.
   */
  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {
    // Validate credentials type
    const googleCreds = credentials as GoogleCredentials;
    const validation = this.validateCredentials(googleCreds);

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
        this.sendRequest(googleCreds, data, dedupeEventId)
      );

      logger.info(`GA4 MP: conversion sent successfully`, {
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

      logger.error(`GA4 MP: conversion failed`, {
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
   * Validate Google credentials format.
   */
  validateCredentials(credentials: unknown): CredentialsValidationResult {
    const errors: string[] = [];

    if (!credentials || typeof credentials !== "object") {
      return { valid: false, errors: ["Credentials must be an object"] };
    }

    const creds = credentials as Record<string, unknown>;

    if (!creds.measurementId || typeof creds.measurementId !== "string") {
      errors.push("measurementId is required");
    } else if (!MEASUREMENT_ID_PATTERN.test(creds.measurementId)) {
      errors.push(
        `Invalid GA4 Measurement ID format: ${creds.measurementId}. Expected format: G-XXXXXXXXXX`
      );
    }

    if (!creds.apiSecret || typeof creds.apiSecret !== "string") {
      errors.push("apiSecret is required");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Parse Google-specific error into standardized format.
   */
  parseError(error: unknown): PlatformError {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          type: "timeout",
          message: `GA4 MP request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`,
          isRetryable: true,
        };
      }

      // Parse HTTP errors
      const httpMatch = error.message.match(/GA4.*error:\s*(\d+)/);
      if (httpMatch) {
        const statusCode = parseInt(httpMatch[1], 10);
        return this.classifyHttpError(statusCode, error.message);
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
   * Build the GA4 Measurement Protocol payload.
   */
  async buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>> {
    return {
      client_id: `server.${data.orderId}`,
      events: [
        {
          name: "purchase",
          params: {
            engagement_time_msec: "1",
            transaction_id: data.orderId,
            value: data.value,
            currency: data.currency,
            items:
              data.lineItems?.map((item) => ({
                item_id: item.productId,
                item_name: item.name,
                quantity: item.quantity,
                price: item.price,
              })) || [],
          },
        },
      ],
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Send the actual HTTP request to GA4.
   */
  private async sendRequest(
    credentials: GoogleCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<ConversionApiResponse> {
    const payload = await this.buildPayload(data, eventId);

    const url = `${GA4_MEASUREMENT_PROTOCOL_URL}?measurement_id=${credentials.measurementId}&api_secret=${credentials.apiSecret}`;

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    // GA4 returns 204 No Content on success
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        conversionId: eventId,
        timestamp: new Date().toISOString(),
      };
    }

    const errorText = await response.text().catch(() => "");
    throw new Error(`GA4 Measurement Protocol error: ${response.status} ${errorText}`);
  }

  /**
   * Classify HTTP error by status code.
   */
  private classifyHttpError(statusCode: number, message: string): PlatformError {
    if (statusCode === 401 || statusCode === 403) {
      return {
        type: "auth_error",
        message: "GA4 authentication failed. Check your API secret.",
        isRetryable: false,
        platformCode: String(statusCode),
      };
    }

    if (statusCode === 429) {
      return {
        type: "rate_limited",
        message: "GA4 rate limit exceeded",
        isRetryable: true,
        platformCode: String(statusCode),
        retryAfter: 60,
      };
    }

    if (statusCode >= 500) {
      return {
        type: "server_error",
        message: `GA4 server error: ${statusCode}`,
        isRetryable: true,
        platformCode: String(statusCode),
      };
    }

    return {
      type: "unknown",
      message,
      isRetryable: statusCode >= 500,
      platformCode: String(statusCode),
    };
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Singleton instance of Google platform service.
 */
export const googleService = new GooglePlatformService();

// =============================================================================
// Legacy Export (Backwards Compatibility)
// =============================================================================

/**
 * Send conversion to Google.
 *
 * @deprecated Use googleService.sendConversion() instead
 */
export async function sendConversionToGoogle(
  credentials: GoogleCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials) {
    throw new Error("Google credentials not configured");
  }

  const result = await googleService.sendConversion(
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
export function generateGooglePixelCode(_config: {
  measurementId: string;
  conversionId?: string;
  conversionLabel?: string;
}): string {
  return "";
}
