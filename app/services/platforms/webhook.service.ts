import type { PlatformType } from "../../types/enums";
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAX_RETRIES = 3;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RETRY_DELAY_MS = 1000;
const DNS_VALIDATION_CACHE_TTL_MS = 15 * 60 * 1000;
const dnsValidationCache = new Map<string, { valid: boolean; error?: string; checkedAt: number }>();

const FORBIDDEN_PATTERNS_PRODUCTION = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/\[fc00:/i,
  /^https?:\/\/\[fe80:/i,
  /^https?:\/\/\[::ffff:0?:/i,
  /^file:/i,
  /^ftp:/i,
];

const FORBIDDEN_PATTERNS_DEVELOPMENT = [
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/\[fc00:/i,
  /^https?:\/\/\[fe80:/i,
  /^https?:\/\/\[::ffff:0?:/i,
  /^file:/i,
  /^ftp:/i,
];

function isPrivateIPv6(ip: string): boolean {
  if (!ip.startsWith('[') || !ip.endsWith(']')) {
    return false;
  }
  const ipv6 = ip.slice(1, -1).toLowerCase();
  if (ipv6 === '::1' || ipv6 === '::') {
    return true;
  }
  if (ipv6.startsWith('fc00:') || ipv6.startsWith('fc01:') || ipv6.startsWith('fd00:')) {
    return true;
  }
  if (ipv6.startsWith('fe80:') || ipv6.startsWith('fe90:') || ipv6.startsWith('fea0:') || ipv6.startsWith('feb0:')) {
    return true;
  }
  if (ipv6.startsWith('ff00:') || ipv6.startsWith('ff01:') || ipv6.startsWith('ff02:') || ipv6.startsWith('ff03:') || 
      ipv6.startsWith('ff04:') || ipv6.startsWith('ff05:') || ipv6.startsWith('ff08:') || ipv6.startsWith('ff0e:')) {
    return true;
  }
  if (ipv6.startsWith('2001:db8:')) {
    return true;
  }
  if (ipv6.startsWith('::ffff:')) {
    const ipv4 = ipv6.substring(7);
    if (/^10\./.test(ipv4) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ipv4) || /^192\.168\./.test(ipv4) || /^127\./.test(ipv4) || /^169\.254\./.test(ipv4) || /^0\./.test(ipv4)) {
      return true;
    }
  }
  if (ipv6.startsWith('2001:10:') || ipv6.startsWith('2001:20:')) {
    return true;
  }
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^0\./.test(ip)) return true;
  return false;
}

function isAlternativeIpHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (/^\d+$/.test(h)) return true;
  if (/^0x[0-9a-f]+$/.test(h)) return true;
  if (/^0[0-7]+$/.test(h)) return true;
  if (/^127\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}$/.test(h)) return true;
  for (const seg of h.split('.')) {
    if (/^0x[0-9a-f]+$/.test(seg)) return true;
    if (/^0[0-7]+$/.test(seg)) return true;
  }
  return false;
}

function isWebhookCredentials(creds: PlatformCredentials): creds is WebhookCredentials {
  return (
    "endpointUrl" in creds &&
    "authType" in creds &&
    typeof (creds as WebhookCredentials).endpointUrl === "string"
  );
}

function hasCrLf(s: string): boolean {
  return s.includes("\r") || s.includes("\n");
}

function validateCustomHeadersNoCrLf(customHeaders: Record<string, string>): { valid: boolean; error?: string } {
  for (const [k, v] of Object.entries(customHeaders)) {
    if (typeof k !== "string" || hasCrLf(k)) {
      return { valid: false, error: "Custom header name or value must not contain CR/LF" };
    }
    if (typeof v !== "string" || hasCrLf(v)) {
      return { valid: false, error: "Custom header name or value must not contain CR/LF" };
    }
  }
  return { valid: true };
}

function applyTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const keys = key.trim().split('.');
    let value: unknown = data;
    for (const k of keys) {
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, k)) {
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
    items: data.lineItems?.map(item => ({
      product_id: item.productId ?? item.id,
      variant_id: item.variantId,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
    })) || [],
  };
}
function validateEndpointUrl(url: string): { valid: boolean; error?: string } {
  const isProduction = process.env.NODE_ENV === 'production';
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol;
    const hostname = parsed.hostname.toLowerCase();

    if (isProduction) {
      if (protocol !== 'https:') {
        return { valid: false, error: 'Endpoint URL must use HTTPS in production' };
      }
      if (parsed.port !== '' && parsed.port !== '443') {
        return { valid: false, error: 'Only port 443 is allowed for HTTPS in production' };
      }
      for (const pattern of FORBIDDEN_PATTERNS_PRODUCTION) {
        if (pattern.test(url)) {
          return { valid: false, error: 'Endpoint URL points to a private/local network (not allowed in production)' };
        }
      }
    } else {
      const isLocalHttp = protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
      const isHttps = protocol === 'https:';
      if (!isLocalHttp && !isHttps) {
        return { valid: false, error: 'Endpoint URL must use HTTPS or http://localhost (development only)' };
      }
      if (isLocalHttp) {
        if (hostname === '127.0.0.1') {
          return { valid: true };
        }
        for (const pattern of FORBIDDEN_PATTERNS_DEVELOPMENT) {
          if (pattern.test(url)) {
            return { valid: false, error: 'Endpoint URL points to a private network (not allowed even in development)' };
          }
        }
        return { valid: true };
      }
      if (isHttps) {
        for (const pattern of FORBIDDEN_PATTERNS_PRODUCTION) {
          if (pattern.test(url)) {
            return { valid: false, error: 'Endpoint URL points to a private/local network (not allowed)' };
          }
        }
      }
    }
    
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      if (isPrivateIPv4(hostname)) {
        return { valid: false, error: 'IP addresses are not allowed; use domain names instead' };
      }
      return { valid: false, error: 'IP addresses are not allowed; use domain names instead' };
    }
    
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      if (isPrivateIPv6(hostname)) {
        return { valid: false, error: 'Private IPv6 addresses are not allowed' };
      }
      return { valid: false, error: 'IPv6 addresses are not allowed; use domain names instead' };
    }

    if (isAlternativeIpHostname(hostname)) {
      return { valid: false, error: 'Hostname format not allowed (alternative IP representation)' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

async function validateEndpointUrlWithDNS(url: string): Promise<{ valid: boolean; error?: string }> {
  const basicValidation = validateEndpointUrl(url);
  if (!basicValidation.valid) {
    return basicValidation;
  }
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || (hostname.startsWith('[') && hostname.endsWith(']'))) {
      return { valid: true };
    }
    const cacheKey = hostname.toLowerCase();
    const now = Date.now();
    const cached = dnsValidationCache.get(cacheKey);
    if (cached && (now - cached.checkedAt) < DNS_VALIDATION_CACHE_TTL_MS) {
      return { valid: cached.valid, error: cached.error };
    }
    try {
      const dns = await import('dns');
      const { promisify } = await import('util');
      const lookup = promisify(dns.lookup);
      const resolved = await lookup(hostname, { family: 0, all: true });
      const records = Array.isArray(resolved) ? resolved : [resolved];
      for (const record of records) {
        const resolvedIp = record.address;
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(resolvedIp)) {
          if (isPrivateIPv4(resolvedIp)) {
            const result = { valid: false as const, error: 'DNS resolution points to private IP address (DNS rebinding protection)' };
            dnsValidationCache.set(cacheKey, { ...result, checkedAt: now });
            return result;
          }
        } else if (resolvedIp.includes(':')) {
          const ipv6Formatted = resolvedIp.startsWith('[') && resolvedIp.endsWith(']') ? resolvedIp : `[${resolvedIp}]`;
          if (isPrivateIPv6(ipv6Formatted)) {
            const result = { valid: false as const, error: 'DNS resolution points to private IPv6 address (DNS rebinding protection)' };
            dnsValidationCache.set(cacheKey, { ...result, checkedAt: now });
            return result;
          }
        }
        if (resolvedIp === '127.0.0.1' || resolvedIp === '::1' || resolvedIp === 'localhost') {
          const result = { valid: false as const, error: 'DNS resolution points to localhost (DNS rebinding protection)' };
          dnsValidationCache.set(cacheKey, { ...result, checkedAt: now });
          return result;
        }
      }
      dnsValidationCache.set(cacheKey, { valid: true, checkedAt: now });
      return { valid: true };
    } catch (dnsError) {
      logger.warn(`DNS lookup failed for ${hostname}, rejecting URL due to DNS resolution failure (security risk)`, {
        error: dnsError instanceof Error ? dnsError.message : String(dnsError),
      });
      const result = { valid: false as const, error: 'DNS resolution failed - cannot verify endpoint safety' };
      dnsValidationCache.set(cacheKey, { ...result, checkedAt: now });
      return result;
    }
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

async function revalidateDnsBeforeFetch(url: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || (hostname.startsWith('[') && hostname.endsWith(']'))) {
      return { valid: true };
    }
    try {
      const dns = await import('dns');
      const { promisify } = await import('util');
      const lookup = promisify(dns.lookup);
      const resolved = await lookup(hostname, { family: 0, all: true });
      const records = Array.isArray(resolved) ? resolved : [resolved];
      for (const record of records) {
        const resolvedIp = record.address;
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(resolvedIp)) {
          if (isPrivateIPv4(resolvedIp)) {
            return { valid: false, error: 'DNS resolution points to private IP (revalidate before fetch)' };
          }
        } else if (resolvedIp.includes(':')) {
          const ipv6Formatted = resolvedIp.startsWith('[') && resolvedIp.endsWith(']') ? resolvedIp : `[${resolvedIp}]`;
          if (isPrivateIPv6(ipv6Formatted)) {
            return { valid: false, error: 'DNS resolution points to private IPv6 (revalidate before fetch)' };
          }
        }
        if (resolvedIp === '127.0.0.1' || resolvedIp === '::1' || resolvedIp === 'localhost') {
          return { valid: false, error: 'DNS resolution points to localhost (revalidate before fetch)' };
        }
      }
      return { valid: true };
    } catch {
      return { valid: false, error: 'DNS resolution failed - cannot verify endpoint safety (revalidate)' };
    }
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

export class WebhookPlatformService implements IPlatformService {
  readonly platform: PlatformType = "webhook" as PlatformType;
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
    const urlValidation = await validateEndpointUrlWithDNS(credentials.endpointUrl);
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
      };
      payload = applyTemplate(credentials.payloadTemplate, templateData);
    } else {
      payload = JSON.stringify(buildDefaultPayload(data, eventId));
    }
    const customHeaders = credentials.customHeaders || {};
    const headerCheck = validateCustomHeadersNoCrLf(customHeaders);
    if (!headerCheck.valid) {
      return {
        success: false,
        error: {
          type: "invalid_config",
          message: headerCheck.error || "Custom header name or value must not contain CR/LF",
          isRetryable: false,
        },
      };
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "TrackingGuardian/1.0",
      "X-Event-ID": eventId,
      ...customHeaders,
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
    const revalidate = await revalidateDnsBeforeFetch(credentials.endpointUrl);
    if (!revalidate.valid) {
      return {
        success: false,
        error: {
          type: "invalid_config",
          message: revalidate.error || "Invalid endpoint URL",
          isRetryable: false,
        },
      };
    }
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
    } else if (creds.customHeaders && typeof creds.customHeaders === "object") {
      const ch = creds.customHeaders as Record<string, string>;
      for (const [k, v] of Object.entries(ch)) {
        if (typeof k !== "string" || hasCrLf(k) || typeof v !== "string" || hasCrLf(v)) {
          errors.push("Custom header name or value must not contain CR/LF");
          break;
        }
      }
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
