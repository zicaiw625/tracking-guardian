import { Platform, type PlatformType } from "../../types/enums";
import type {
  ConversionData,
  PlatformCredentials,
  PlatformError,
  ConversionApiResponse,
  WebhookCredentials,
} from "../../types";
import type {
  IPlatformService,
  PlatformSendResult,
  CredentialsValidationResult,
} from "./interface";
import { fetchWithTimeout, measureDuration } from "./interface";
import { logger } from "../../utils/logger.server";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const FORBIDDEN_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/\[::1\]/,
  /^file:/i,
  /^ftp:/i,
];

function isWebhookCredentials(creds: PlatformCredentials): creds is WebhookCredentials {
  return (
    "endpointUrl" in creds &&
    "authType" in creds &&
    typeof (creds as WebhookCredentials).endpointUrl === "string"
  );
}

function applyTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const keys = key.trim().split('.');
    let value: unknown = data;
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return match;
      }
    }
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'string') {
      return JSON.stringify(value).slice(1, -1);
    }
    return String(value);
  });
}
function buildDefaultPayload(data: ConversionData, eventId: string): Record<string, unknown> {
  return {
    event: "purchase",
    event_id: eventId,
    timestamp: new Date().toISOString(),
    order_id: data.orderId,
    order_number: data.orderNumber,
    value: data.value,
    currency: data.currency,
    customer: {
      email_hash: data.preHashedUserData?.em || null,
      phone_hash: data.preHashedUserData?.ph || null,
    },
    items: data.lineItems?.map(item => ({
      product_id: item.productId,
      variant_id: item.variantId,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
    })) || [],
  };
}
function validateEndpointUrl(url: string): { valid: boolean; error?: string } {

  if (!url.startsWith('https:
    return { valid: false, error: 'Endpoint URL must use HTTPS' };
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(url)) {
      return { valid: false, error: 'Endpoint URL points to a private/local network (not allowed)' };
    }
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { valid: false, error: 'IP addresses are not allowed; use domain names instead' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}
export class WebhookPlatformService implements IPlatformService {
  readonly platform: PlatformType = Platform.WEBHOOK;
  readonly displayName = "通用 HTTP Webhook";

  async sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult> {
    if (!isWebhookCredentials(credentials)) {
      return {
        success: false,
        error: {
          type: "invalid_config",
          message: "Invalid webhook credentials",
          isRetryable: false,
        },
      };
    }
    const urlValidation = validateEndpointUrl(credentials.endpointUrl);
    if (!urlValidation.valid) {
      return {
        success: false,
        error: {
          type: "invalid_config",
          message: urlValidation.error || "Invalid endpoint URL",
          isRetryable: false,
        },
      };
    }
    let payload: string;
    if (credentials.payloadTemplate) {
      const templateData = {
        ...data,
        eventId,
        timestamp: new Date().toISOString(),
        lineItems: data.lineItems || [],
        preHashedUserData: data.preHashedUserData || {},
      };
      payload = applyTemplate(credentials.payloadTemplate, templateData);
    } else {
      payload = JSON.stringify(buildDefaultPayload(data, eventId));
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "TrackingGuardian/1.0",
      "X-Event-ID": eventId,
      ...(credentials.customHeaders || {}),
    };
    switch (credentials.authType) {
      case "bearer":
        if (credentials.authValue) {
          headers["Authorization"] = `Bearer ${credentials.authValue}`;
        }
        break;
      case "basic":
        if (credentials.authValue) {
          headers["Authorization"] = `Basic ${Buffer.from(credentials.authValue).toString("base64")}`;
        }
        break;
      case "header":

        if (credentials.authValue) {
          const [headerName, ...valueParts] = credentials.authValue.split(":");
          if (headerName && valueParts.length > 0) {
            headers[headerName.trim()] = valueParts.join(":").trim();
          }
        }
        break;
      case "none":
      default:

        break;
    }
    const timeoutMs = credentials.timeoutMs || DEFAULT_TIMEOUT_MS;
    try {
      const [response, duration] = await measureDuration(async () => {
        return fetchWithTimeout(
          credentials.endpointUrl,
          {
            method: "POST",
            headers,
            body: payload,
          },
          timeoutMs
        );
      });
      const responseText = await response.text();
      let responseData: unknown;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }
      if (response.ok) {
        logger.info(`Webhook delivery successful`, {
          endpoint: credentials.endpointUrl.substring(0, 50) + "...",
          eventId,
          duration,
          status: response.status,
        });
        return {
          success: true,
          response: {
            success: true,
            conversionId: eventId,
            timestamp: new Date().toISOString(),
          } as ConversionApiResponse,
          duration,
        };
      } else {
        const error = this.parseError({
          status: response.status,
          statusText: response.statusText,
          body: responseData,
        });
        logger.warn(`Webhook delivery failed`, {
          endpoint: credentials.endpointUrl.substring(0, 50) + "...",
          eventId,
          status: response.status,
          error: error.message,
        });
        return {
          success: false,
          error,
          duration,
        };
      }
    } catch (error) {
      const platformError = this.parseError(error);
      logger.error(`Webhook delivery error`, {
        endpoint: credentials.endpointUrl.substring(0, 50) + "...",
        eventId,
        error: platformError.message,
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

    if (!creds.endpointUrl || typeof creds.endpointUrl !== "string") {
      errors.push("Endpoint URL is required");
    } else {
      const urlValidation = validateEndpointUrl(creds.endpointUrl);
      if (!urlValidation.valid) {
        errors.push(urlValidation.error || "Invalid endpoint URL");
      }
    }

    const validAuthTypes = ["none", "bearer", "basic", "header"];
    if (creds.authType && !validAuthTypes.includes(creds.authType as string)) {
      errors.push(`Auth type must be one of: ${validAuthTypes.join(", ")}`);
    }

    if (creds.authType && creds.authType !== "none" && !creds.authValue) {
      errors.push("Auth value is required for the selected auth type");
    }

    if (creds.customHeaders && typeof creds.customHeaders !== "object") {
      errors.push("Custom headers must be an object");
    }

    if (creds.payloadTemplate && typeof creds.payloadTemplate !== "string") {
      errors.push("Payload template must be a string");
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
          message: "Webhook request timed out",
          isRetryable: true,
        };
      }
      if (error.message.includes("fetch failed") || error.message.includes("network")) {
        return {
          type: "network_error",
          message: `Network error: ${error.message}`,
          isRetryable: true,
        };
      }
      return {
        type: "unknown",
        message: error.message,
        isRetryable: true,
        rawError: error,
      };
    }
    if (typeof error === "object" && error !== null) {
      const err = error as Record<string, unknown>;
      const status = err.status as number | undefined;
      const body = err.body as Record<string, unknown> | undefined;
      if (status) {
        if (status === 401 || status === 403) {
          return {
            type: "auth_error",
            message: "Authentication failed - check your credentials",
            statusCode: status,
            isRetryable: false,
          };
        }
        if (status === 429) {
          return {
            type: "rate_limited",
            message: "Rate limit exceeded - try again later",
            statusCode: status,
            isRetryable: true,
            retryAfter: 60,
          };
        }
        if (status >= 500) {
          return {
            type: "server_error",
            message: `Server error (${status})`,
            statusCode: status,
            isRetryable: true,
          };
        }
        if (status >= 400) {
          return {
            type: "validation_error",
            message: body?.message
              ? String(body.message)
              : `Client error (${status})`,
            statusCode: status,
            isRetryable: false,
            rawError: body,
          };
        }
      }
    }
    return {
      type: "unknown",
      message: "Unknown webhook error",
      isRetryable: true,
      rawError: error,
    };
  }

  async buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>> {
    return buildDefaultPayload(data, eventId);
  }
}

export const webhookService = new WebhookPlatformService();

export async function sendConversionToWebhook(
  credentials: WebhookCredentials,
  data: ConversionData,
  eventId: string
): Promise<PlatformSendResult> {
  return webhookService.sendConversion(credentials, data, eventId);
}
