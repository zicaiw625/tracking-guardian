// Google Ads Conversion API integration
// Uses Google Ads API v15 for Enhanced Conversions

import type { ConversionData, GoogleCredentials, ConversionApiResponse } from "../../types";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto";

// Google Ads API endpoint
const GOOGLE_ADS_API_VERSION = "v15";
const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com";

interface UserIdentifier {
  hashedEmail?: string;
  hashedPhoneNumber?: string;
  addressInfo?: {
    hashedFirstName?: string;
    hashedLastName?: string;
    hashedStreetAddress?: string;
    city?: string;
    state?: string;
    countryCode?: string;
    postalCode?: string;
  };
}

interface ConversionUploadPayload {
  conversions: Array<{
    conversionAction: string;
    conversionDateTime: string;
    conversionValue: number;
    currencyCode: string;
    orderId: string;
    userIdentifiers: UserIdentifier[];
  }>;
  partialFailure: boolean;
}

/**
 * Sends conversion data to Google Ads using the Conversion Upload API
 * Supports Enhanced Conversions for improved match rates
 */
export async function sendConversionToGoogle(
  credentials: GoogleCredentials | null,
  conversionData: ConversionData
): Promise<ConversionApiResponse> {
  if (!credentials?.conversionId || !credentials?.conversionLabel) {
    throw new Error("Google Ads credentials not configured: missing conversionId or conversionLabel");
  }

  if (!credentials.customerId) {
    throw new Error("Google Ads credentials not configured: missing customerId");
  }

  // Build user identifiers for enhanced conversions
  const userIdentifiers: UserIdentifier[] = [];

  // Add hashed email
  if (conversionData.email) {
    userIdentifiers.push({
      hashedEmail: await hashValue(normalizeEmail(conversionData.email)),
    });
  }

  // Add hashed phone number
  if (conversionData.phone) {
    userIdentifiers.push({
      hashedPhoneNumber: await hashValue(normalizePhone(conversionData.phone)),
    });
  }

  // Add address info if available
  if (conversionData.firstName || conversionData.lastName || conversionData.city) {
    const addressInfo: UserIdentifier["addressInfo"] = {};
    
    if (conversionData.firstName) {
      addressInfo.hashedFirstName = await hashValue(conversionData.firstName.toLowerCase().trim());
    }
    if (conversionData.lastName) {
      addressInfo.hashedLastName = await hashValue(conversionData.lastName.toLowerCase().trim());
    }
    if (conversionData.city) {
      addressInfo.city = conversionData.city;
    }
    if (conversionData.state) {
      addressInfo.state = conversionData.state;
    }
    if (conversionData.country) {
      addressInfo.countryCode = conversionData.country;
    }
    if (conversionData.zip) {
      addressInfo.postalCode = conversionData.zip;
    }

    userIdentifiers.push({ addressInfo });
  }

  // Format conversion date time (must be in format: yyyy-mm-dd hh:mm:ss+|-hh:mm)
  const now = new Date();
  const conversionDateTime = formatGoogleAdsDateTime(now);

  // Build the conversion payload
  const conversionAction = `customers/${credentials.customerId}/conversionActions/${credentials.conversionId}`;
  
  const payload: ConversionUploadPayload = {
    conversions: [
      {
        conversionAction,
        conversionDateTime,
        conversionValue: conversionData.value,
        currencyCode: conversionData.currency,
        orderId: conversionData.orderId,
        userIdentifiers,
      },
    ],
    partialFailure: true, // Allow partial success if some identifiers fail
  };

  console.log(`Sending conversion to Google Ads: order=${conversionData.orderId}, value=${conversionData.value} ${conversionData.currency}`);

  // Check if we have developer token and access credentials for real API call
  if (credentials.developerToken && credentials.refreshToken) {
    try {
      // Get access token using refresh token
      const accessToken = await getGoogleAccessToken(credentials);
      
      // Make the API call
      const response = await fetch(
        `${GOOGLE_ADS_API_BASE}/${GOOGLE_ADS_API_VERSION}/customers/${credentials.customerId}:uploadConversionAdjustments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
            "developer-token": credentials.developerToken,
            "login-customer-id": credentials.customerId,
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Google Ads API error:", errorData);
        throw new Error(`Google Ads API error: ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      console.log("Google Ads conversion uploaded successfully:", result);
      
      return {
        success: true,
        conversionId: conversionData.orderId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to send conversion to Google Ads:", errorMessage);
      throw new Error(`Google Ads API call failed: ${errorMessage}`);
    }
  } else {
    // Fallback: Use Measurement Protocol for GA4 (simpler but less features)
    console.log("Using GA4 Measurement Protocol fallback (developer token not configured)");
    return await sendToGA4MeasurementProtocol(credentials, conversionData);
  }
}

/**
 * Fallback: Send conversion to GA4 using Measurement Protocol
 * This is simpler but doesn't support all Enhanced Conversion features
 */
async function sendToGA4MeasurementProtocol(
  credentials: GoogleCredentials,
  conversionData: ConversionData
): Promise<ConversionApiResponse> {
  // GA4 Measurement Protocol endpoint
  const measurementId = credentials.conversionId; // Can also be GA4 measurement ID
  const apiSecret = credentials.conversionLabel; // Can be used as API secret

  const payload = {
    client_id: `server_${conversionData.orderId}`, // Generate a client ID
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
  };

  try {
    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    // GA4 Measurement Protocol returns 204 No Content on success
    if (response.status === 204 || response.ok) {
      console.log("GA4 Measurement Protocol: conversion sent successfully");
      return {
        success: true,
        conversionId: conversionData.orderId,
        timestamp: new Date().toISOString(),
      };
    } else {
      const errorText = await response.text();
      throw new Error(`GA4 Measurement Protocol error: ${response.status} ${errorText}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("GA4 Measurement Protocol failed:", errorMessage);
    throw new Error(`GA4 Measurement Protocol failed: ${errorMessage}`);
  }
}

/**
 * Get OAuth2 access token using refresh token
 */
async function getGoogleAccessToken(credentials: GoogleCredentials): Promise<string> {
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    throw new Error("Missing OAuth2 credentials for Google Ads API");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to refresh Google access token: ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Format date time for Google Ads API
 * Format: yyyy-mm-dd hh:mm:ss+|-hh:mm
 */
function formatGoogleAdsDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  
  // Get timezone offset
  const offset = -date.getTimezoneOffset();
  const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, "0");
  const offsetSign = offset >= 0 ? "+" : "-";

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

// Generate Web Pixel code for Google Ads
export function generateGooglePixelCode(config: {
  measurementId: string;
  conversionId?: string;
  conversionLabel?: string;
}): string {
  return `// Google Analytics 4 & Google Ads - Web Pixel Implementation
// Auto-generated by Tracking Guardian

import {register, analytics} from '@shopify/web-pixels-extension';

register(({analytics, browser, settings}) => {
  const MEASUREMENT_ID = '${config.measurementId}';
  ${config.conversionId ? `const CONVERSION_ID = '${config.conversionId}';` : ''}
  ${config.conversionLabel ? `const CONVERSION_LABEL = '${config.conversionLabel}';` : ''}

  // Initialize gtag
  const script = document.createElement('script');
  script.src = \`https://www.googletagmanager.com/gtag/js?id=\${MEASUREMENT_ID}\`;
  script.async = true;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag(...args) {
    window.dataLayer.push(args);
  }
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);

  // Track page views
  analytics.subscribe('page_viewed', (event) => {
    gtag('event', 'page_view', {
      page_title: event.context.document.title,
      page_location: event.context.document.location.href,
    });
  });

  // Track product views
  analytics.subscribe('product_viewed', (event) => {
    const product = event.data.productVariant;
    gtag('event', 'view_item', {
      currency: product.price.currencyCode,
      value: parseFloat(product.price.amount),
      items: [{
        item_id: product.id,
        item_name: product.title,
        price: parseFloat(product.price.amount),
      }],
    });
  });

  // Track add to cart
  analytics.subscribe('product_added_to_cart', (event) => {
    const item = event.data.cartLine;
    gtag('event', 'add_to_cart', {
      currency: item.merchandise.price.currencyCode,
      value: parseFloat(item.merchandise.price.amount) * item.quantity,
      items: [{
        item_id: item.merchandise.id,
        item_name: item.merchandise.title,
        price: parseFloat(item.merchandise.price.amount),
        quantity: item.quantity,
      }],
    });
  });

  // Track checkout started
  analytics.subscribe('checkout_started', (event) => {
    const checkout = event.data.checkout;
    gtag('event', 'begin_checkout', {
      currency: checkout.currencyCode,
      value: parseFloat(checkout.totalPrice.amount),
      items: checkout.lineItems.map((item) => ({
        item_id: item.id,
        item_name: item.title,
        price: parseFloat(item.variant?.price?.amount || '0'),
        quantity: item.quantity,
      })),
    });
  });

  // Track purchase completion
  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data.checkout;
    
    // GA4 purchase event
    gtag('event', 'purchase', {
      transaction_id: checkout.order?.id || checkout.token,
      value: parseFloat(checkout.totalPrice.amount),
      currency: checkout.currencyCode,
      tax: parseFloat(checkout.totalTax?.amount || '0'),
      shipping: parseFloat(checkout.shippingLine?.price?.amount || '0'),
      items: checkout.lineItems.map((item) => ({
        item_id: item.id,
        item_name: item.title,
        price: parseFloat(item.variant?.price?.amount || '0'),
        quantity: item.quantity,
      })),
    });
    ${
      config.conversionId && config.conversionLabel
        ? `
    // Google Ads conversion
    gtag('event', 'conversion', {
      send_to: \`\${CONVERSION_ID}/\${CONVERSION_LABEL}\`,
      value: parseFloat(checkout.totalPrice.amount),
      currency: checkout.currencyCode,
      transaction_id: checkout.order?.id || checkout.token,
    });`
        : ''
    }
  });
});
`;
}

// Helper functions imported from utils/crypto

