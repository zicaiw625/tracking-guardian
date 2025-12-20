/**
 * TikTok Events API Service
 * 
 * P0-01: This service handles Protected Customer Data gracefully:
 * - All PII fields are optional and may be null
 * - Conversions are sent with whatever data is available
 * - Missing PII is logged for debugging but does not cause failures
 */

import type { ConversionData, TikTokCredentials, ConversionApiResponse } from "../../types";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto";
import { logger } from "../../utils/logger";

const TIKTOK_API_TIMEOUT_MS = 30000; 

interface TikTokUserData {
  email?: string;  // hashed email
  phone_number?: string;  // hashed phone
}

/**
 * P0-01: Build user data for TikTok Events API
 * 
 * TikTok requires either email or phone for better matching.
 * This function handles missing PII gracefully.
 */
async function buildHashedUserData(
  conversionData: ConversionData,
  orderId: string
): Promise<{ user: TikTokUserData; hasPii: boolean }> {
  const user: TikTokUserData = {};
  let hasPii = false;
  
  if (conversionData.email) {
    user.email = await hashValue(normalizeEmail(conversionData.email));
    hasPii = true;
  }
  if (conversionData.phone) {
    user.phone_number = await hashValue(normalizePhone(conversionData.phone));
    hasPii = true;
  }
  
  // P0-01: Log when no PII is available
  if (!hasPii && process.env.NODE_ENV !== "test") {
    logger.debug(`[P0-01] TikTok Events API: No PII for order ${orderId.slice(0, 8)}...`, {
      platform: "tiktok",
      note: "Conversion will still be recorded but may have lower match rate",
    });
  }
  
  return { user, hasPii };
}

export async function sendConversionToTikTok(
  credentials: TikTokCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.pixelId || !credentials?.accessToken) {
    throw new Error("TikTok Pixel credentials not configured");
  }

  if (!/^[A-Z0-9]{20,}$/i.test(credentials.pixelId)) {
    throw new Error("Invalid TikTok Pixel ID format");
  }

  const timestamp = new Date().toISOString();

  // P0-01: Build user data with PII tracking
  const { user, hasPii } = await buildHashedUserData(
    conversionData,
    conversionData.orderId
  );

  // P0-01: Log when sending conversion with no PII
  if (!hasPii) {
    logger.info(`[P0-01] Sending TikTok conversion with no PII for order ${conversionData.orderId.slice(0, 8)}...`, {
      platform: "tiktok",
      note: "Conversion will still be recorded",
    });
  }

  const contents = conversionData.lineItems?.map((item) => ({
    content_id: item.productId,
    content_name: item.name,
    quantity: item.quantity,
    price: item.price,
  })) || [];

  const dedupeEventId = eventId || `${conversionData.orderId}_purchase_${Date.now()}`;

  const eventPayload = {
    pixel_code: credentials.pixelId,
    event: "CompletePayment",
    event_id: dedupeEventId, 
    timestamp,
    context: {
      user,
    },
    properties: {
      currency: conversionData.currency,
      value: conversionData.value,
      order_id: conversionData.orderId,
      contents,
      content_type: "product",
    },
    ...(credentials.testEventCode && { test_event_code: credentials.testEventCode }),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIKTOK_API_TIMEOUT_MS);

  try {
  
  const response = await fetch(
    "https://business-api.tiktok.com/open_api/v1.3/pixel/track/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": credentials.accessToken,
      },
      body: JSON.stringify({ data: [eventPayload] }),
        signal: controller.signal,
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
      
      const errorMessage = errorData.message || "Unknown TikTok API error";
      throw new Error(`TikTok API error: ${errorMessage}`);
    }

    const result = await response.json();
    
    logger.info(`TikTok conversion sent: order=${conversionData.orderId.slice(0, 8)}...`);

    return {
      success: true,
      conversionId: conversionData.orderId,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`TikTok API request timeout after ${TIKTOK_API_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * @deprecated This function is deprecated and should not be used.
 * 
 * Tracking Guardian now uses a pure server-side Events API approach:
 * - Our App Pixel Extension handles checkout_completed event collection
 * - Server-side receives orders/paid webhook and sends to TikTok Events API
 * - No merchant-pasted Custom Pixel code is needed
 * 
 * The old approach (generating code for merchants to paste) doesn't work because:
 * - Custom Pixels in "strict" mode don't have access to browser APIs
 * - Custom Pixels don't support the `settings` API  
 * - The code uses `register` which is for App Pixels, not Custom Pixels
 * 
 * To track conversions in TikTok:
 * 1. Configure TikTok Events API credentials in Settings
 * 2. Enable server-side tracking
 * 3. Tracking Guardian will automatically send conversions via Events API
 */
export function generateTikTokPixelCode(_config: { pixelId: string }): string {
  // Return instructions instead of code
  return `/* ⚠️ DEPRECATED - DO NOT USE ⚠️

Tracking Guardian no longer generates client-side pixel code.

To track TikTok conversions:
1. Go to Tracking Guardian Settings → Server-side Tracking
2. Select "TikTok Events API"
3. Enter your TikTok Pixel ID and Access Token
4. Enable server-side tracking

Tracking Guardian will automatically send CompletePayment events
to TikTok Events API when orders are placed.

Benefits of server-side tracking:
- Not affected by ad blockers
- Works in strict sandbox mode
- More accurate attribution
- Higher match rates with hashed PII
- GDPR compliant (server-side hashing)
*/`;
}

