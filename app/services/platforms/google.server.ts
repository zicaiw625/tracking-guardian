/**
 * Google Conversion API integration
 * 
 * Supports two modes:
 * 1. GA4 Measurement Protocol (Recommended for MVP) - Simple, requires only measurementId + apiSecret
 * 2. Google Ads Offline Conversions (Advanced) - Requires OAuth2 and developer token
 * 
 * IMPORTANT: These are distinct APIs with different credentials:
 * - GA4 MP: measurementId (G-XXXXXXXX) + apiSecret
 * - Google Ads: customerId + conversionActionId + developerToken + OAuth2
 */

import type { ConversionData, GoogleCredentials, ConversionApiResponse } from "../../types";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto";

// API configuration
const GOOGLE_ADS_API_VERSION = "v15";
const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com";
const API_TIMEOUT_MS = 30000;
const TOKEN_REFRESH_TIMEOUT_MS = 10000;

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

interface UserIdentifier {
  hashedEmail?: string;
  hashedPhoneNumber?: string;
  addressInfo?: {
    hashedFirstName?: string;
    hashedLastName?: string;
    city?: string;
    state?: string;
    countryCode?: string;
    postalCode?: string;
  };
}

/**
 * Main entry point for Google server-side conversions
 * Automatically routes to GA4 or Google Ads based on available credentials
 */
export async function sendConversionToGoogle(
  credentials: GoogleCredentials | null,
  conversionData: ConversionData
): Promise<ConversionApiResponse> {
  if (!credentials) {
    throw new Error("Google credentials not configured");
  }

  // Determine which API to use based on available credentials
  const hasGA4Credentials = credentials.measurementId && credentials.apiSecret;
  const hasGoogleAdsCredentials = credentials.customerId && 
    credentials.conversionActionId && 
    credentials.developerToken && 
    credentials.refreshToken;
  
  // Legacy field mapping for backwards compatibility
  const legacyGA4 = credentials.conversionId?.startsWith("G-") && credentials.conversionLabel;

  if (hasGoogleAdsCredentials) {
    console.log(`Using Google Ads Offline Conversions for order=${conversionData.orderId}`);
    return await sendToGoogleAdsOfflineConversions(credentials, conversionData);
  } else if (hasGA4Credentials) {
    console.log(`Using GA4 Measurement Protocol for order=${conversionData.orderId}`);
    return await sendToGA4MeasurementProtocol(
      credentials.measurementId!,
      credentials.apiSecret!,
      conversionData
    );
  } else if (legacyGA4) {
    // Legacy support: conversionId contains G-XXXXXX, conversionLabel contains API secret
    console.warn(
      "Using legacy field mapping (conversionId/conversionLabel). " +
      "Please update to use measurementId/apiSecret instead."
    );
    return await sendToGA4MeasurementProtocol(
      credentials.conversionId!,
      credentials.conversionLabel!,
      conversionData
    );
  } else {
    throw new Error(
      "Invalid Google credentials configuration. Please provide either:\n" +
      "1. GA4: measurementId (G-XXXXXXXXXX) + apiSecret\n" +
      "2. Google Ads: customerId + conversionActionId + developerToken + OAuth2 credentials"
    );
  }
}

/**
 * Send conversion to GA4 using Measurement Protocol
 * 
 * This is the recommended approach for MVP:
 * - Simple setup (just measurementId + apiSecret)
 * - No OAuth required
 * - Works with GA4 properties
 * 
 * Limitations:
 * - Cannot attribute to Google Ads clicks directly
 * - Limited user matching (no GCLID support)
 */
async function sendToGA4MeasurementProtocol(
  measurementId: string,
  apiSecret: string,
  conversionData: ConversionData
): Promise<ConversionApiResponse> {
  // Validate measurementId format
  if (!measurementId.match(/^G-[A-Z0-9]+$/)) {
    throw new Error(
      `Invalid GA4 Measurement ID format: ${measurementId}. ` +
      `Expected format: G-XXXXXXXXXX`
    );
  }

  // Build user properties for better matching
  const userProperties: Record<string, { value: string }> = {};
  if (conversionData.email) {
    // Hash email for privacy (GA4 will use this for matching)
    userProperties.hashed_email = { 
      value: await hashValue(normalizeEmail(conversionData.email))
    };
  }

  const payload = {
    client_id: `server.${conversionData.orderId}`,
    // Use user_id if available for better cross-device tracking
    ...(conversionData.email && { user_id: await hashValue(normalizeEmail(conversionData.email)) }),
    events: [
      {
        name: "purchase",
        params: {
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
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    
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
    // It also returns 200/204 for invalid data (fire-and-forget design)
    if (response.status === 204 || response.ok) {
      console.log(`GA4 MP: conversion sent for order=${conversionData.orderId}`);
      return {
        success: true,
        conversionId: conversionData.orderId,
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
 * Send conversion to Google Ads using Offline Conversions API
 * 
 * Requirements:
 * - Google Ads API access (developer token)
 * - OAuth2 credentials
 * - Conversion action configured in Google Ads
 * 
 * Benefits:
 * - Direct attribution to Google Ads clicks
 * - Enhanced Conversions support
 * - Better ROAS tracking
 */
async function sendToGoogleAdsOfflineConversions(
  credentials: GoogleCredentials,
  conversionData: ConversionData
): Promise<ConversionApiResponse> {
  if (!credentials.customerId || !credentials.conversionActionId || 
      !credentials.developerToken || !credentials.refreshToken) {
    throw new Error("Missing required Google Ads credentials");
  }

  // Build user identifiers for enhanced conversions
  const userIdentifiers: UserIdentifier[] = [];

  if (conversionData.email) {
    userIdentifiers.push({
      hashedEmail: await hashValue(normalizeEmail(conversionData.email)),
    });
  }

  if (conversionData.phone) {
    userIdentifiers.push({
      hashedPhoneNumber: await hashValue(normalizePhone(conversionData.phone)),
    });
  }

  if (conversionData.firstName || conversionData.lastName) {
    const addressInfo: UserIdentifier["addressInfo"] = {};
    if (conversionData.firstName) {
      addressInfo.hashedFirstName = await hashValue(conversionData.firstName.toLowerCase().trim());
    }
    if (conversionData.lastName) {
      addressInfo.hashedLastName = await hashValue(conversionData.lastName.toLowerCase().trim());
    }
    if (conversionData.city) addressInfo.city = conversionData.city;
    if (conversionData.state) addressInfo.state = conversionData.state;
    if (conversionData.country) addressInfo.countryCode = conversionData.country;
    if (conversionData.zip) addressInfo.postalCode = conversionData.zip;
    userIdentifiers.push({ addressInfo });
  }

  const conversionDateTime = formatGoogleAdsDateTime(new Date());
  
  // Build conversion action resource name
  const conversionAction = `customers/${credentials.customerId}/conversionActions/${credentials.conversionActionId}`;
  
  const payload = {
    conversions: [{
      conversionAction,
      conversionDateTime,
      conversionValue: conversionData.value,
      currencyCode: conversionData.currency,
      orderId: conversionData.orderId,
      userIdentifiers,
    }],
    partialFailure: true,
  };

  try {
    const accessToken = await getGoogleAccessToken(credentials);
    
    // Use uploadClickConversions endpoint (NOT uploadConversionAdjustments)
    // uploadConversionAdjustments is for modifying existing conversions
    const response = await fetchWithTimeout(
      `${GOOGLE_ADS_API_BASE}/${GOOGLE_ADS_API_VERSION}/customers/${credentials.customerId}:uploadClickConversions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "developer-token": credentials.developerToken,
          "login-customer-id": credentials.customerId,
        },
        body: JSON.stringify(payload),
      },
      API_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
      console.error(`Google Ads API error: ${errorMessage}`);
      throw new Error(`Google Ads API error: ${errorMessage}`);
    }

    const result = await response.json();
    
    // Check for partial failures
    if (result.partialFailureError) {
      console.warn(`Google Ads partial failure: ${JSON.stringify(result.partialFailureError)}`);
    }
    
    console.log(`Google Ads: conversion uploaded for order=${conversionData.orderId}`);
    
    return {
      success: true,
      conversionId: conversionData.orderId,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Google Ads API timeout after ${API_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

/**
 * Get OAuth2 access token using refresh token
 */
async function getGoogleAccessToken(credentials: GoogleCredentials): Promise<string> {
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    throw new Error("Missing OAuth2 credentials for Google Ads API");
  }

  try {
    const response = await fetchWithTimeout(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          refresh_token: credentials.refreshToken,
          grant_type: "refresh_token",
        }),
      },
      TOKEN_REFRESH_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to refresh Google access token: ${errorData.error_description || errorData.error || response.status}`
      );
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Google token refresh timeout after ${TOKEN_REFRESH_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

/**
 * Format date time for Google Ads API
 * Format: yyyy-mm-dd hh:mm:ss+|-hh:mm
 */
function formatGoogleAdsDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  
  const offset = -date.getTimezoneOffset();
  const offsetSign = offset >= 0 ? "+" : "-";
  const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
  const offsetMinutes = pad(Math.abs(offset) % 60);

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

// Generate Web Pixel code for Google Ads
// Uses browser.window/browser.document for Web Pixel sandbox compatibility
export function generateGooglePixelCode(config: {
  measurementId: string;
  conversionId?: string;
  conversionLabel?: string;
}): string {
  return `// Google Analytics 4 & Google Ads - Web Pixel Implementation
// Auto-generated by Tracking Guardian
// Compatible with Shopify Web Pixel strict sandbox

import { register } from '@shopify/web-pixels-extension';

register(({ analytics, browser }) => {
  const MEASUREMENT_ID = '${config.measurementId}';
  ${config.conversionId ? `const CONVERSION_ID = '${config.conversionId}';` : ''}
  ${config.conversionLabel ? `const CONVERSION_LABEL = '${config.conversionLabel}';` : ''}
  
  // Idempotency guard - prevent double initialization
  if (browser.window.__TG_GA_LOADED) return;
  browser.window.__TG_GA_LOADED = true;

  // Event queue for events fired before SDK loads
  const eventQueue = [];
  let gtagReady = false;

  // Safe gtag wrapper that queues events until ready
  function safeGtag(...args) {
    if (gtagReady && browser.window.gtag) {
      browser.window.gtag(...args);
    } else {
      eventQueue.push(args);
    }
  }

  // Initialize gtag using browser APIs (sandbox-compatible)
  const script = browser.document.createElement('script');
  script.src = \`https://www.googletagmanager.com/gtag/js?id=\${MEASUREMENT_ID}\`;
  script.async = true;
  script.onload = () => {
    browser.window.dataLayer = browser.window.dataLayer || [];
    function gtag() {
      browser.window.dataLayer.push(arguments);
    }
    browser.window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', MEASUREMENT_ID);
    ${config.conversionId ? `gtag('config', CONVERSION_ID);` : ''}
    
    gtagReady = true;
    
    // Flush queued events
    eventQueue.forEach(args => gtag(...args));
    eventQueue.length = 0;
  };
  browser.document.head.appendChild(script);

  // Track page views
  analytics.subscribe('page_viewed', (event) => {
    safeGtag('event', 'page_view', {
      page_title: event.context?.document?.title || '',
      page_location: event.context?.document?.location?.href || '',
    });
  });

  // Track product views
  analytics.subscribe('product_viewed', (event) => {
    const product = event.data?.productVariant;
    if (!product) return;
    
    safeGtag('event', 'view_item', {
      currency: product.price?.currencyCode || 'USD',
      value: parseFloat(product.price?.amount || '0'),
      items: [{
        item_id: product.id,
        item_name: product.title,
        price: parseFloat(product.price?.amount || '0'),
      }],
    });
  });

  // Track add to cart
  analytics.subscribe('product_added_to_cart', (event) => {
    const item = event.data?.cartLine;
    if (!item?.merchandise) return;
    
    safeGtag('event', 'add_to_cart', {
      currency: item.merchandise.price?.currencyCode || 'USD',
      value: parseFloat(item.merchandise.price?.amount || '0') * (item.quantity || 1),
      items: [{
        item_id: item.merchandise.id,
        item_name: item.merchandise.title,
        price: parseFloat(item.merchandise.price?.amount || '0'),
        quantity: item.quantity || 1,
      }],
    });
  });

  // Track checkout started
  analytics.subscribe('checkout_started', (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;
    
    safeGtag('event', 'begin_checkout', {
      currency: checkout.currencyCode || 'USD',
      value: parseFloat(checkout.totalPrice?.amount || '0'),
      items: (checkout.lineItems || []).map((item) => ({
        item_id: item.id,
        item_name: item.title,
        price: parseFloat(item.variant?.price?.amount || '0'),
        quantity: item.quantity || 1,
      })),
    });
  });

  // Track purchase completion
  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;
    
    // GA4 purchase event
    safeGtag('event', 'purchase', {
      transaction_id: checkout.order?.id || checkout.token,
      value: parseFloat(checkout.totalPrice?.amount || '0'),
      currency: checkout.currencyCode || 'USD',
      tax: parseFloat(checkout.totalTax?.amount || '0'),
      shipping: parseFloat(checkout.shippingLine?.price?.amount || '0'),
      items: (checkout.lineItems || []).map((item) => ({
        item_id: item.id,
        item_name: item.title,
        price: parseFloat(item.variant?.price?.amount || '0'),
        quantity: item.quantity || 1,
      })),
    });
    ${
      config.conversionId && config.conversionLabel
        ? `
    // Google Ads conversion
    safeGtag('event', 'conversion', {
      send_to: \`\${CONVERSION_ID}/\${CONVERSION_LABEL}\`,
      value: parseFloat(checkout.totalPrice?.amount || '0'),
      currency: checkout.currencyCode || 'USD',
      transaction_id: checkout.order?.id || checkout.token,
    });`
        : ''
    }
  });
});
`;
}

// Helper functions imported from utils/crypto

