import type { ConversionData, TikTokCredentials, ConversionApiResponse } from "../../types";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto";
import { logger } from "../../utils/logger";

const TIKTOK_API_TIMEOUT_MS = 30000; 

interface TikTokUserData {
  email?: string;
  phone_number?: string;
}

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

  const { user, hasPii } = await buildHashedUserData(
    conversionData,
    conversionData.orderId
  );

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

export function generateTikTokPixelCode(_config: { pixelId: string }): string {
  return "";
}
