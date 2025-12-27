

import type {
  ConversionData,
  ConversionApiResponse,
  PlatformCredentials,
  PlatformError,
  Result,
} from "../../types";
import type { PlatformType } from "../../types/enums";
import type { AppError } from "../../utils/errors";

export interface PlatformSendResult {
  success: boolean;
  response?: ConversionApiResponse;
  error?: PlatformError;
  duration?: number;
}

export type SendResult = Result<
  { response: ConversionApiResponse; duration: number },
  AppError
>;

export interface CredentialsValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PlatformHealthStatus {
  healthy: boolean;
  lastError?: string;
  lastSuccessAt?: Date;
  errorRate?: number;
}

export interface IPlatformService {

  readonly platform: PlatformType;

  readonly displayName: string;

  sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult>;

  validateCredentials(credentials: unknown): CredentialsValidationResult;

  parseError(error: unknown): PlatformError;

  buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>>;
}

export {
  isGoogleCredentials,
  isMetaCredentials,
  isTikTokCredentials,
} from "../../types/platform";

export const DEFAULT_API_TIMEOUT_MS = 30000;

export const MAX_RETRY_ATTEMPTS = 3;

export const RETRY_DELAY_MULTIPLIER = 2;

export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function generateDedupeEventId(
  orderId: string,
  eventType: string = "purchase",
  timestamp: number = Date.now()
): string {
  return `${orderId}_${eventType}_${timestamp}`;
}

export async function measureDuration<T>(
  fn: () => Promise<T>
): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  const duration = Math.round(performance.now() - start);
  return [result, duration];
}
