/**
 * Meta (Facebook) Conversions API Service
 * 
 * P0-01: This service handles Protected Customer Data gracefully:
 * - All PII fields are optional and may be null
 * - Conversions are sent with whatever data is available
 * - Missing PII is logged for debugging but does not cause failures
 */

import type { ConversionData, MetaCredentials, ConversionApiResponse } from "../../types";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto";
import { 
  classifyHttpError, 
  classifyJsError, 
  parseMetaError,
  type PlatformError,
} from "./base.server";
import { logger } from "../../utils/logger";

const META_API_VERSION = "v18.0";
const META_API_TIMEOUT_MS = 30000; 

interface MetaUserData {
  em?: string[];  // email hash
  ph?: string[];  // phone hash
  fn?: string[];  // first name hash
  ln?: string[];  // last name hash
  ct?: string[];  // city hash
  st?: string[];  // state hash
  country?: string[];  // country hash
  zp?: string[];  // zip hash
}

/**
 * P0-01: Build user data for Meta CAPI
 * 
 * This function gracefully handles missing PII:
 * - Returns whatever data is available
 * - Never fails due to missing PII
 * - Logs the data quality for debugging
 */
async function buildHashedUserData(
  conversionData: ConversionData,
  orderId: string
): Promise<{ userData: MetaUserData; piiQuality: string }> {
  const userData: MetaUserData = {};
  const availableFields: string[] = [];
  const missingFields: string[] = [];

  // P0-01: Process each PII field, tracking what's available
  if (conversionData.email) {
    userData.em = [await hashValue(normalizeEmail(conversionData.email))];
    availableFields.push("email");
  } else {
    missingFields.push("email");
  }

  if (conversionData.phone) {
    userData.ph = [await hashValue(normalizePhone(conversionData.phone))];
    availableFields.push("phone");
  } else {
    missingFields.push("phone");
  }

  if (conversionData.firstName) {
    const normalized = conversionData.firstName.toLowerCase().trim();
    if (normalized) {
      userData.fn = [await hashValue(normalized)];
      availableFields.push("firstName");
    }
  }

  if (conversionData.lastName) {
    const normalized = conversionData.lastName.toLowerCase().trim();
    if (normalized) {
      userData.ln = [await hashValue(normalized)];
      availableFields.push("lastName");
    }
  }

  if (conversionData.city) {
    const normalized = conversionData.city.toLowerCase().replace(/\s/g, '');
    if (normalized) {
      userData.ct = [await hashValue(normalized)];
      availableFields.push("city");
    }
  }

  if (conversionData.state) {
    const normalized = conversionData.state.toLowerCase().trim();
    if (normalized) {
      userData.st = [await hashValue(normalized)];
      availableFields.push("state");
    }
  }

  if (conversionData.country) {
    const normalized = conversionData.country.toLowerCase().trim();
    if (normalized) {
      userData.country = [await hashValue(normalized)];
      availableFields.push("country");
    }
  }

  if (conversionData.zip) {
    const normalized = conversionData.zip.replace(/\s/g, '');
    if (normalized) {
      userData.zp = [await hashValue(normalized)];
      availableFields.push("zip");
    }
  }
  
  // P0-01: Determine PII quality level
  let piiQuality: string;
  if (availableFields.length === 0) {
    piiQuality = "none";
  } else if (availableFields.includes("email") || availableFields.includes("phone")) {
    piiQuality = "good"; // Primary identifiers available
  } else {
    piiQuality = "partial"; // Only secondary identifiers
  }

  // Log for debugging (not as an error, just info)
  if (missingFields.length > 0 && process.env.NODE_ENV !== "test") {
    logger.debug(`[P0-01] Meta CAPI PII status for order ${orderId.slice(0, 8)}...`, {
      piiQuality,
      availableFieldCount: availableFields.length,
      totalPossibleFields: 8,
    });
  }

  return { userData, piiQuality };
}

export async function sendConversionToMeta(
  credentials: MetaCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.pixelId || !credentials?.accessToken) {
    throw new Error("Meta Pixel credentials not configured");
  }

  if (!/^\d{15,16}$/.test(credentials.pixelId)) {
    throw new Error("Invalid Meta Pixel ID format");
  }

  const eventTime = Math.floor(Date.now() / 1000);

  // P0-01: Build user data with PII quality tracking
  const { userData, piiQuality } = await buildHashedUserData(
    conversionData, 
    conversionData.orderId
  );

  // P0-01: Log when sending conversion with limited data
  if (piiQuality === "none") {
    logger.info(`[P0-01] Sending Meta conversion with no PII for order ${conversionData.orderId.slice(0, 8)}...`, {
      platform: "meta",
      piiQuality,
      // This is expected when Protected Customer Data scope is not granted
      note: "Conversion will still be recorded but may have lower match rate",
    });
  }

  const contents = conversionData.lineItems?.map((item) => ({
    id: item.productId,
    quantity: item.quantity,
    item_price: item.price,
  })) || [];

  const dedupeEventId = eventId || `${conversionData.orderId}_purchase_${eventTime}`;

  const eventPayload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: dedupeEventId, 
        action_source: "website",
        user_data: userData,
        custom_data: {
          currency: conversionData.currency,
          value: conversionData.value,
          order_id: conversionData.orderId,
          contents,
          content_type: "product",
        },
      },
    ],
    ...(credentials.testEventCode && { test_event_code: credentials.testEventCode }),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), META_API_TIMEOUT_MS);

  try {

  const response = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${credentials.pixelId}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",

          "Authorization": `Bearer ${credentials.accessToken}`,
      },
        body: JSON.stringify({
          ...eventPayload,
          access_token: credentials.accessToken,
        }),
        signal: controller.signal,
    }
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
} catch (error) {
  
  if (error instanceof Error) {
    
    if ((error as Error & { platformError?: PlatformError }).platformError) {
      throw error;
    }

    const platformError = classifyJsError(error);
    const enhancedError = new Error(error.message) as Error & { platformError: PlatformError };
    enhancedError.platformError = platformError;
    throw enhancedError;
  }
  throw error;
} finally {
  clearTimeout(timeoutId);
}
}

export function extractMetaError(error: unknown): PlatformError | null {
  if (error instanceof Error) {
    return (error as Error & { platformError?: PlatformError }).platformError || null;
  }
  return null;
}

/**
 * @deprecated This function is deprecated and should not be used.
 * 
 * Tracking Guardian now uses a pure server-side CAPI approach:
 * - Our App Pixel Extension handles checkout_completed event collection
 * - Server-side receives orders/paid webhook and sends CAPI to Meta
 * - No merchant-pasted Custom Pixel code is needed
 * 
 * The old approach (generating code for merchants to paste) doesn't work because:
 * - Custom Pixels in "strict" mode don't have access to browser APIs
 * - Custom Pixels don't support the `settings` API
 * - The code uses `register` which is for App Pixels, not Custom Pixels
 * 
 * To track conversions in Meta:
 * 1. Configure Meta CAPI credentials in Settings
 * 2. Enable server-side tracking
 * 3. Tracking Guardian will automatically send conversions via CAPI
 */
export function generateMetaPixelCode(_config: { pixelId: string }): string {
  // Return instructions instead of code
  return `/* ⚠️ DEPRECATED - DO NOT USE ⚠️

Tracking Guardian no longer generates client-side pixel code.

To track Meta conversions:
1. Go to Tracking Guardian Settings → Server-side Tracking
2. Select "Meta Conversions API (CAPI)"
3. Enter your Pixel ID and Access Token
4. Enable server-side tracking

Tracking Guardian will automatically send Purchase events to Meta CAPI
when orders are placed.

Benefits of server-side tracking:
- Not affected by ad blockers or iOS 14+ restrictions
- Higher match rates with hashed PII
- More accurate attribution
- Works in strict sandbox mode
- GDPR compliant (server-side hashing)
*/`;
}

