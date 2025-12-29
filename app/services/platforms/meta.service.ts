

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  MetaCredentials,
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
  classifyHttpError,
  classifyJsError,
  parseMetaError,
  buildMetaHashedUserData,
  type MetaUserData,
} from "./base-platform.service";

const META_API_VERSION = "v21.0";
const META_API_BASE_URL = "https:
const PIXEL_ID_PATTERN = /^\d{15,16}$/;

export class MetaPlatformService implements IPlatformService {
  readonly platform = Platform.META;
  readonly displayName = "Meta (Facebook)";

  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {
    const metaCreds = credentials as MetaCredentials;
    const validation = this.validateCredentials(metaCreds);

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
        this.sendRequest(metaCreds, data, dedupeEventId)
      );

      logger.info(`Meta CAPI: conversion sent successfully`, {
        orderId: data.orderId.slice(0, 8),
        eventId: dedupeEventId,
        eventsReceived: response.events_received,
        durationMs: duration,
      });

      return {
        success: true,
        response,
        duration,
      };
    } catch (error) {
      const platformError = this.parseError(error);

      logger.error(`Meta CAPI: conversion failed`, {
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
      errors.push("pixelId is required");
    } else if (!PIXEL_ID_PATTERN.test(creds.pixelId)) {
      errors.push(
        `Invalid Meta Pixel ID format: ${creds.pixelId}. Expected 15-16 digit number.`
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

  parseError(error: unknown): PlatformError {
    if (error instanceof Error) {

      const attachedError = (error as Error & { platformError?: PlatformError }).platformError;
      if (attachedError) {
        return attachedError;
      }

      if (error.name === "AbortError") {
        return {
          type: "timeout",
          message: `Meta CAPI request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`,
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
    const { userData } = await buildMetaHashedUserData(data);

    const contents =
      data.lineItems?.map((item) => ({
        id: item.productId,
        quantity: item.quantity,
        item_price: item.price,
      })) || [];

    return {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTime,
          event_id: eventId,
          action_source: "website",
          user_data: userData,
          custom_data: {
            currency: data.currency,
            value: data.value,
            order_id: data.orderId,
            contents,
            content_type: "product",
          },
        },
      ],
    };
  }

  private async sendRequest(
    credentials: MetaCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<ConversionApiResponse> {
    const { userData, piiQuality } = await buildMetaHashedUserData(data);

    if (piiQuality === "none") {
      logger.info(`Meta CAPI: Sending conversion with no PII`, {
        orderId: data.orderId.slice(0, 8),
        note: "Conversion will still be recorded but may have lower match rate",
      });
    }

    const eventTime = Math.floor(Date.now() / 1000);
    const contents =
      data.lineItems?.map((item) => ({
        id: item.productId,
        quantity: item.quantity,
        item_price: item.price,
      })) || [];

    const eventPayload = {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTime,
          event_id: eventId,
          action_source: "website",
          user_data: userData,
          custom_data: {
            currency: data.currency,
            value: data.value,
            order_id: data.orderId,
            contents,
            content_type: "product",
          },
        },
      ],
      ...(credentials.testEventCode && { test_event_code: credentials.testEventCode }),
    };

    const url = `${META_API_BASE_URL}/${META_API_VERSION}/${credentials.pixelId}/events`;

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.accessToken}`,
        },
        body: JSON.stringify({
          ...eventPayload,
          access_token: credentials.accessToken,
        }),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      let platformError: PlatformError;

      if (errorData.error) {
        platformError = parseMetaError(errorData);
      } else {
        platformError = classifyHttpError(response.status, errorData);
      }

      const enhancedError = new Error(`Meta API error: ${platformError.message}`) as Error & {
        platformError: PlatformError;
      };
      enhancedError.platformError = platformError;
      throw enhancedError;
    }

    const result = await response.json();

    return {
      success: true,
      events_received: result.events_received,
      fbtrace_id: result.fbtrace_id,
      timestamp: new Date().toISOString(),
    };
  }
}

export const metaService = new MetaPlatformService();

export async function sendConversionToMeta(
  credentials: MetaCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.pixelId || !credentials?.accessToken) {
    throw new Error("Meta Pixel credentials not configured");
  }

  const result = await metaService.sendConversion(
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

export function extractMetaError(error: unknown): PlatformError | null {
  if (error instanceof Error) {
    return (error as Error & { platformError?: PlatformError }).platformError || null;
  }
  return null;
}
