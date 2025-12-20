

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
