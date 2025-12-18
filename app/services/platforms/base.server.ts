/**
 * Base utilities for all platform integrations
 * Provides common functionality to reduce code duplication
 */

import type { ConversionData, ConversionApiResponse } from "../../types";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto";
import { ExternalServiceError } from "../../utils/errors";

// Default timeout for external API calls
export const DEFAULT_API_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Common hashed user data structure
 */
export interface HashedUserData {
  hashedEmail?: string;
  hashedPhone?: string;
  hashedFirstName?: string;
  hashedLastName?: string;
  hashedCity?: string;
  hashedState?: string;
  hashedCountry?: string;
  hashedZip?: string;
}

/**
 * Builds hashed user data from conversion data
 * Normalizes and hashes all PII fields
 */
export async function buildHashedUserData(
  conversionData: ConversionData
): Promise<HashedUserData> {
  const userData: HashedUserData = {};

  if (conversionData.email) {
    userData.hashedEmail = await hashValue(normalizeEmail(conversionData.email));
  }

  if (conversionData.phone) {
    userData.hashedPhone = await hashValue(normalizePhone(conversionData.phone));
  }

  if (conversionData.firstName) {
    const normalized = conversionData.firstName.toLowerCase().trim();
    if (normalized) {
      userData.hashedFirstName = await hashValue(normalized);
    }
  }

  if (conversionData.lastName) {
    const normalized = conversionData.lastName.toLowerCase().trim();
    if (normalized) {
      userData.hashedLastName = await hashValue(normalized);
    }
  }

  if (conversionData.city) {
    const normalized = conversionData.city.toLowerCase().replace(/\s/g, "");
    if (normalized) {
      userData.hashedCity = await hashValue(normalized);
    }
  }

  if (conversionData.state) {
    const normalized = conversionData.state.toLowerCase().trim();
    if (normalized) {
      userData.hashedState = await hashValue(normalized);
    }
  }

  if (conversionData.country) {
    const normalized = conversionData.country.toLowerCase().trim();
    if (normalized) {
      userData.hashedCountry = await hashValue(normalized);
    }
  }

  if (conversionData.zip) {
    const normalized = conversionData.zip.replace(/\s/g, "");
    if (normalized) {
      userData.hashedZip = await hashValue(normalized);
    }
  }

  return userData;
}

/**
 * Fetch with timeout support
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Handle timeout error
 */
export function handleTimeoutError(error: unknown, service: string, timeoutMs: number): never {
  if (error instanceof Error && error.name === "AbortError") {
    throw new ExternalServiceError(
      service,
      `${service} API request timeout after ${timeoutMs}ms`
    );
  }
  throw error;
}

/**
 * Create a successful conversion API response
 */
export function createSuccessResponse(
  orderId: string,
  additionalData?: Partial<ConversionApiResponse>
): ConversionApiResponse {
  return {
    success: true,
    conversionId: orderId,
    timestamp: new Date().toISOString(),
    ...additionalData,
  };
}

/**
 * Log conversion send result
 */
export function logConversionSent(
  platform: string,
  orderId: string,
  value?: number,
  currency?: string
): void {
  const valueStr = value !== undefined && currency ? ` value=${value} ${currency}` : "";
  console.log(`${platform} conversion sent: order=${orderId}${valueStr}`);
}

/**
 * Common product contents type
 */
export interface ProductContent {
  id: string;
  name?: string;
  quantity: number;
  price: number;
}

/**
 * Build product contents from line items
 */
export function buildProductContents(
  conversionData: ConversionData
): ProductContent[] {
  return (
    conversionData.lineItems?.map((item) => ({
      id: item.productId,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
    })) || []
  );
}

/**
 * Validate required credentials
 */
export function validateCredentials<T extends object>(
  credentials: T | null,
  requiredFields: (keyof T)[],
  platformName: string
): asserts credentials is T {
  if (!credentials) {
    throw new Error(`${platformName} credentials not configured`);
  }

  for (const field of requiredFields) {
    if (!credentials[field]) {
      throw new Error(
        `${platformName} credentials missing required field: ${String(field)}`
      );
    }
  }
}
