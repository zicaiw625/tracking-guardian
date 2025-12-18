/**
 * Google GA4 Measurement Protocol Integration
 * 
 * This module provides server-side conversion tracking via GA4 Measurement Protocol.
 * 
 * Why GA4 MP only (not Google Ads API)?
 * - Simple setup: Only needs measurementId + apiSecret
 * - No OAuth required
 * - Works for purchase events which is the primary use case
 * - Google Ads can import GA4 conversions for attribution
 * 
 * For Google Ads Enhanced Conversions, users should:
 * 1. Set up GA4 Measurement Protocol here
 * 2. Import GA4 conversions into Google Ads (recommended by Google)
 */

import type { ConversionData, GoogleCredentials, ConversionApiResponse } from "../../types";
import { hashValue, normalizeEmail } from "../../utils/crypto";

// API configuration
const API_TIMEOUT_MS = 30000;

/**
 * Fetch with timeout support
 */
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

/**
 * Send conversion to Google via GA4 Measurement Protocol
 * 
 * Requirements:
 * - measurementId: GA4 Property Measurement ID (e.g., G-XXXXXXXXXX)
 * - apiSecret: GA4 Measurement Protocol API secret (from GA4 Admin > Data Streams)
 * 
 * @param credentials - GA4 credentials (measurementId + apiSecret)
 * @param conversionData - Conversion event data
 * @param eventId - Optional event ID for deduplication
 */
export async function sendConversionToGoogle(
  credentials: GoogleCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials) {
    throw new Error("Google credentials not configured");
  }

  // Validate required GA4 credentials
  if (!credentials.measurementId || !credentials.apiSecret) {
    throw new Error(
      "GA4 Measurement Protocol requires measurementId and apiSecret. " +
      "Get these from GA4 Admin > Data Streams > Your Stream > Measurement Protocol API secrets"
    );
  }

  // Validate measurementId format
  if (!credentials.measurementId.match(/^G-[A-Z0-9]+$/)) {
    throw new Error(
      `Invalid GA4 Measurement ID format: ${credentials.measurementId}. ` +
      `Expected format: G-XXXXXXXXXX`
    );
  }

  console.log(`Sending GA4 MP conversion for order=${conversionData.orderId}`);

  // Build user properties for better matching
  const userProperties: Record<string, { value: string }> = {};
  let userId: string | undefined;
  
  if (conversionData.email) {
    const hashedEmail = await hashValue(normalizeEmail(conversionData.email));
    userProperties.hashed_email = { value: hashedEmail };
    userId = hashedEmail;
  }

  // Generate event ID for deduplication
  const dedupeEventId = eventId || `${conversionData.orderId}_purchase_${Date.now()}`;

  const payload = {
    client_id: `server.${conversionData.orderId}`,
    // Use hashed email as user_id for better cross-device tracking
    ...(userId && { user_id: userId }),
    events: [
      {
        name: "purchase",
        params: {
          // Event ID for deduplication (if same event sent from client)
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
    ...(Object.keys(userProperties).length > 0 && { user_properties: userProperties }),
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

    // GA4 Measurement Protocol returns 204 No Content on success
    // Note: It also returns 2xx for invalid data (fire-and-forget design)
    // To debug, use the validation endpoint:
    // https://www.google-analytics.com/debug/mp/collect
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

/**
 * Generate Web Pixel code for Google Analytics 4
 * Note: This is kept for backwards compatibility with the migrate page
 * The new architecture sends events to /api/pixel-events instead
 */
export function generateGooglePixelCode(config: {
  measurementId: string;
  conversionId?: string;
  conversionLabel?: string;
}): string {
  return `// Google Analytics 4 - Tracking Guardian Web Pixel
// This pixel forwards events to the backend for server-side processing
// Configure backend_url in pixel settings

import { register } from '@shopify/web-pixels-extension';

register(({ analytics, settings, init }) => {
  const backendUrl = settings.backend_url;
  const shopDomain = init.data?.shop?.myshopifyDomain || "";
  
  if (!backendUrl) {
    console.warn("[Tracking Guardian] backend_url not configured");
    return;
  }

  function sendEvent(eventName, data) {
    fetch(backendUrl + "/api/pixel-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName,
        timestamp: Date.now(),
        shopDomain,
        data,
      }),
    }).catch(() => {});
  }

  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;
    
    sendEvent("checkout_completed", {
      orderId: checkout.order?.id || checkout.token,
      value: parseFloat(checkout.totalPrice?.amount || "0"),
      currency: checkout.currencyCode || "USD",
      items: (checkout.lineItems || []).map((item) => ({
        id: item.id,
        name: item.title,
        price: parseFloat(item.variant?.price?.amount || "0"),
        quantity: item.quantity || 1,
      })),
    });
  });
});
`;
}
