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
  classifyJsError,
} from "./base-platform.service";

const GA4_MEASUREMENT_PROTOCOL_URL = process.env.GA4_USE_EU_ENDPOINT === "true"
  ? "https://region1.google-analytics.com/mp/collect"
  : "https://www.google-analytics.com/mp/collect";
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;

export class GooglePlatformService implements IPlatformService {
  readonly platform = Platform.GOOGLE;
  readonly displayName = "GA4 (Measurement Protocol)";
  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {
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
  parseError(error: unknown): PlatformError {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          type: "timeout",
          message: `GA4 MP request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`,
          isRetryable: true,
        };
      }
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
  async buildPayload(
    data: ConversionData,
    _eventId: string
  ): Promise<Record<string, unknown>> {
    const providedClientId = (data as ConversionData & { clientId?: string }).clientId;
    const clientId = providedClientId || `server.${Date.now()}.${data.orderId.slice(-8)}`;
    return {
      client_id: clientId,
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
                item_id: item.productId ?? item.variantId ?? item.id,
                item_name: item.name,
                quantity: item.quantity,
                price: item.price,
              })) || [],
          },
        },
      ],
    };
  }
  private async sendRequest(
    credentials: GoogleCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<ConversionApiResponse> {
    const providedClientId = (data as ConversionData & { clientId?: string }).clientId;
    let clientId: string;
    if (providedClientId && /^\d+\.\d+$/.test(providedClientId)) {
      clientId = providedClientId;
    } else {
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 1000000000);
      clientId = `${timestamp}.${random}`;
    }
    const payload = {
      client_id: clientId,
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
                item_id: item.productId ?? item.variantId ?? item.id,
                item_name: item.name,
                quantity: item.quantity,
                price: item.price,
              })) || [],
          },
        },
      ],
    };
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

export const googleService = new GooglePlatformService();

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
