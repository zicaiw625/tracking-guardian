

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
  hashUserData,
} from "./base-platform.service";

const TWITTER_API_BASE_URL = "https://ads-api.twitter.com";

export interface TwitterCredentials {
  pixelId: string;
  accessToken: string;
  testMode?: boolean;
}

const TWITTER_EVENT_TYPES = {
  purchase: "Purchase",
  add_to_cart: "AddToCart",
  view_content: "ViewContent",
  page_view: "PageView",
  initiate_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  sign_up: "SignUp",
  search: "Search",
  lead: "Lead",
  download: "Download",
} as const;

export class TwitterPlatformService implements IPlatformService {
  readonly platform = "twitter" as const;
  readonly displayName = "Twitter/X";

  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {
    const twitterCreds = credentials as TwitterCredentials;
    const validation = this.validateCredentials(twitterCreds);

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
        this.sendRequest(twitterCreds, data, dedupeEventId)
      );

      logger.info(`Twitter CAPI: conversion sent successfully`, {
        orderId: data.orderId.slice(0, 8),
        eventId: dedupeEventId,
        status: response.success,
        durationMs: duration,
      });

      return {
        success: true,
        response,
        duration,
      };
    } catch (error) {
      const platformError = this.parseError(error);

      logger.error(`Twitter CAPI: conversion failed`, {
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
      errors.push("Twitter Pixel ID is required");
    }

    if (!creds.accessToken || typeof creds.accessToken !== "string") {
      errors.push("OAuth Bearer Token is required");
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
          message: `Twitter CAPI request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`,
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
    const eventTime = new Date().toISOString();

    const hashedEmail = data.email ? await hashUserData(data.email.toLowerCase().trim()) : undefined;
    const hashedPhone = data.phone ? await hashUserData(data.phone.replace(/\D/g, '')) : undefined;

    return {
      conversion_time: eventTime,
      event_id: eventId,
      identifiers: [
        ...(hashedEmail ? [{ hashed_email: hashedEmail }] : []),
        ...(hashedPhone ? [{ hashed_phone_number: hashedPhone }] : []),
      ],
      conversion_event: TWITTER_EVENT_TYPES.purchase,
      value: data.value.toString(),
      currency: data.currency,
      number_items: data.lineItems?.reduce((sum, item) => sum + item.quantity, 0) || 1,
      order_id: data.orderId,
      contents: data.lineItems?.map(item => ({
        content_id: item.productId,
        content_name: item.name,
        content_price: item.price.toString(),
        num_items: item.quantity,
      })) || [],
    };
  }

  private async sendRequest(
    credentials: TwitterCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<ConversionApiResponse> {
    const eventTime = new Date().toISOString();

    const hashedEmail = data.email ? await hashUserData(data.email.toLowerCase().trim()) : undefined;
    const hashedPhone = data.phone ? await hashUserData(data.phone.replace(/\D/g, '')) : undefined;

    const identifiers: Array<Record<string, string>> = [];
    if (hashedEmail) {
      identifiers.push({ hashed_email: hashedEmail });
    }
    if (hashedPhone) {
      identifiers.push({ hashed_phone_number: hashedPhone });
    }

    const eventPayload = {
      conversions: [
        {
          conversion_time: eventTime,
          event_id: eventId,
          identifiers,
          conversion_event: TWITTER_EVENT_TYPES.purchase,
          value: data.value.toString(),
          currency: data.currency,
          number_items: data.lineItems?.reduce((sum, item) => sum + item.quantity, 0) || 1,
          order_id: data.orderId,
          contents: data.lineItems?.map(item => ({
            content_id: item.productId,
            content_name: item.name,
            content_price: item.price.toString(),
            num_items: item.quantity,
          })) || [],
        },
      ],
    };

    const url = `${TWITTER_API_BASE_URL}/${credentials.pixelId}`;

    const response = await fetchWithTimeout(
      url,
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
      let platformError: PlatformError;

      if (errorData.errors && Array.isArray(errorData.errors)) {
        const twitterErrors = errorData.errors.map((e: { message?: string }) => e.message).join("; ");
        platformError = {
          type: response.status === 401 ? "auth_error" :
                response.status === 429 ? "rate_limited" :
                response.status >= 500 ? "server_error" : "validation_error",
          message: twitterErrors || `HTTP ${response.status}`,
          statusCode: response.status,
          isRetryable: response.status >= 500 || response.status === 429,
        };
      } else {
        platformError = classifyHttpError(response.status, errorData);
      }

      const enhancedError = new Error(`Twitter API error: ${platformError.message}`) as Error & {
        platformError: PlatformError;
      };
      enhancedError.platformError = platformError;
      throw enhancedError;
    }

    const result = await response.json();

    return {
      success: true,
      conversionId: result.data?.id || eventId,
      timestamp: new Date().toISOString(),
    };
  }
}

export const twitterService = new TwitterPlatformService();

export async function sendConversionToTwitter(
  credentials: TwitterCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.pixelId || !credentials?.accessToken) {
    throw new Error("Twitter Pixel credentials not configured");
  }

  const result = await twitterService.sendConversion(
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

