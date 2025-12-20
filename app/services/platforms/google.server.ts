import type { ConversionData, GoogleCredentials, ConversionApiResponse } from "../../types";

const API_TIMEOUT_MS = 30000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendConversionToGoogle(
  credentials: GoogleCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials) {
    throw new Error("Google credentials not configured");
  }

  if (!credentials.measurementId || !credentials.apiSecret) {
    throw new Error(
      "GA4 Measurement Protocol requires measurementId and apiSecret. " +
      "Get these from GA4 Admin > Data Streams > Your Stream > Measurement Protocol API secrets"
    );
  }

  if (!credentials.measurementId.match(/^G-[A-Z0-9]+$/)) {
    throw new Error(
      `Invalid GA4 Measurement ID format: ${credentials.measurementId}. ` +
      `Expected format: G-XXXXXXXXXX`
    );
  }

  console.log(`Sending GA4 MP conversion for order=${conversionData.orderId}`);

  const dedupeEventId = eventId || `${conversionData.orderId}_purchase_${Date.now()}`;

  const payload: Record<string, unknown> = {
    client_id: `server.${conversionData.orderId}`,
    events: [
      {
        name: "purchase",
        params: {
          engagement_time_msec: "1",
          transaction_id: conversionData.orderId,
          value: conversionData.value,
          currency: conversionData.currency,
          items: conversionData.lineItems?.map((item) => ({
            item_id: item.productId,
            item_name: item.name,
            quantity: item.quantity,
            price: item.price,
          })) || [],
        },
      },
    ],
  };

  try {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(credentials.measurementId)}&api_secret=${encodeURIComponent(credentials.apiSecret)}`;
    
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      API_TIMEOUT_MS
    );

    if (response.status === 204 || response.ok) {
      console.log(`GA4 MP: conversion sent successfully for order=${conversionData.orderId}, eventId=${dedupeEventId}`);
      return {
        success: true,
        conversionId: dedupeEventId,
        timestamp: new Date().toISOString(),
      };
    } else {
      const errorText = await response.text().catch(() => "");
      throw new Error(`GA4 Measurement Protocol error: ${response.status} ${errorText}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`GA4 MP timeout after ${API_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

export function generateGooglePixelCode(_config: {
  measurementId: string;
  conversionId?: string;
  conversionLabel?: string;
}): string {
  return `/* ⚠️ DEPRECATED - DO NOT USE ⚠️

Tracking Guardian no longer generates client-side pixel code.

To track Google conversions:
1. Go to Tracking Guardian Settings → Server-side Tracking
2. Enter your GA4 Measurement ID and API Secret
3. Enable server-side tracking

Tracking Guardian will automatically send Purchase events to GA4
via the Measurement Protocol when orders are placed.

Benefits of server-side tracking:
- Not affected by ad blockers
- More accurate attribution
- Works even if customer closes browser quickly
- GDPR/privacy compliant (server-side hashing)
*/`;
}
