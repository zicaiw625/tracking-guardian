// Meta (Facebook) Conversions API integration

import type { ConversionData, MetaCredentials, ConversionApiResponse } from "../../types";
import { hashValue, normalizePhone, normalizeEmail } from "../../utils/crypto";

// API configuration
const META_API_VERSION = "v18.0";
const META_API_TIMEOUT_MS = 30000; // 30 seconds

// User data field types for Meta CAPI
interface MetaUserData {
  em?: string[];  // hashed email
  ph?: string[];  // hashed phone
  fn?: string[];  // hashed first name
  ln?: string[];  // hashed last name
  ct?: string[];  // hashed city
  st?: string[];  // hashed state
  country?: string[];  // hashed country
  zp?: string[];  // hashed zip
}

/**
 * Builds hashed user data for Meta Conversions API
 * All PII is normalized and hashed with SHA-256 before sending
 */
async function buildHashedUserData(conversionData: ConversionData): Promise<MetaUserData> {
  const userData: MetaUserData = {};
  
  // Hash email (normalize: lowercase, trim)
  if (conversionData.email) {
    userData.em = [await hashValue(normalizeEmail(conversionData.email))];
  }
  
  // Hash phone (normalize: remove non-digits except +)
  if (conversionData.phone) {
    userData.ph = [await hashValue(normalizePhone(conversionData.phone))];
  }
  
  // Hash first name (normalize: lowercase, trim)
  if (conversionData.firstName) {
    const normalized = conversionData.firstName.toLowerCase().trim();
    if (normalized) {
      userData.fn = [await hashValue(normalized)];
    }
  }
  
  // Hash last name (normalize: lowercase, trim)
  if (conversionData.lastName) {
    const normalized = conversionData.lastName.toLowerCase().trim();
    if (normalized) {
      userData.ln = [await hashValue(normalized)];
    }
  }
  
  // Hash city (normalize: lowercase, remove spaces)
  if (conversionData.city) {
    const normalized = conversionData.city.toLowerCase().replace(/\s/g, '');
    if (normalized) {
      userData.ct = [await hashValue(normalized)];
    }
  }
  
  // Hash state (normalize: lowercase)
  if (conversionData.state) {
    const normalized = conversionData.state.toLowerCase().trim();
    if (normalized) {
      userData.st = [await hashValue(normalized)];
    }
  }
  
  // Hash country (normalize: lowercase, 2-letter code)
  if (conversionData.country) {
    const normalized = conversionData.country.toLowerCase().trim();
    if (normalized) {
      userData.country = [await hashValue(normalized)];
    }
  }
  
  // Hash zip (normalize: remove spaces)
  if (conversionData.zip) {
    const normalized = conversionData.zip.replace(/\s/g, '');
    if (normalized) {
      userData.zp = [await hashValue(normalized)];
    }
  }
  
  return userData;
}

/**
 * Sends conversion data to Meta Conversions API
 * 
 * Security notes:
 * - All PII is hashed with SHA-256 before transmission
 * - Access token is sent via secure header, not URL parameter
 * - Request has timeout to prevent hanging
 * 
 * Deduplication:
 * - Uses event_id for client/server deduplication
 * - Meta will ignore duplicate events with same event_id within 48 hours
 */
export async function sendConversionToMeta(
  credentials: MetaCredentials | null,
  conversionData: ConversionData,
  eventId?: string
): Promise<ConversionApiResponse> {
  if (!credentials?.pixelId || !credentials?.accessToken) {
    throw new Error("Meta Pixel credentials not configured");
  }

  // Validate pixel ID format (should be 15-16 digits)
  if (!/^\d{15,16}$/.test(credentials.pixelId)) {
    throw new Error("Invalid Meta Pixel ID format");
  }

  const eventTime = Math.floor(Date.now() / 1000);

  // Build user data with hashed PII
  const userData = await buildHashedUserData(conversionData);

  // Build contents array for product data (no PII)
  const contents = conversionData.lineItems?.map((item) => ({
    id: item.productId,
    quantity: item.quantity,
    item_price: item.price,
  })) || [];

  // Generate event_id for deduplication if not provided
  // Format: orderId_purchase_timestamp (unique per order)
  const dedupeEventId = eventId || `${conversionData.orderId}_purchase_${eventTime}`;

  const eventPayload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: dedupeEventId, // For client/server deduplication
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

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), META_API_TIMEOUT_MS);

  try {
  // Make the API call to Meta Conversions API
    // Note: Using access_token as query param is required by Meta's API design
    // The token is sent over HTTPS so it's encrypted in transit
  const response = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${credentials.pixelId}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
          // Meta requires access_token as query param, but we can also include it in header
          // for additional security layers that inspect headers
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
    const errorData = await response.json();
      // Don't log the full error as it might contain sensitive info
      const errorMessage = errorData.error?.message || "Unknown Meta API error";
      throw new Error(`Meta API error: ${errorMessage}`);
  }

    const result = await response.json();
    
    return {
      success: true,
      events_received: result.events_received,
      fbtrace_id: result.fbtrace_id,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Meta API request timeout after ${META_API_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Generate Web Pixel code for Meta
//
// WARNING (P2-1): This template uses browser.window/browser.document for DOM injection.
// This is only compatible with "lax" or "custom pixel" sandbox mode, NOT strict mode.
// For strict sandbox compatibility, use Tracking Guardian's built-in pixel + Meta CAPI.
export function generateMetaPixelCode(config: { pixelId: string }): string {
  return `// Meta (Facebook) Pixel - Web Pixel Implementation
// Auto-generated by Tracking Guardian
//
// NOTE: This code requires "lax" sandbox mode to work.
// It will NOT work in "strict" sandbox mode.
// For strict mode, configure Meta Conversions API via Tracking Guardian settings instead.

import { register } from '@shopify/web-pixels-extension';

register(({ analytics, browser }) => {
  const PIXEL_ID = '${config.pixelId}';
  
  // Check if browser APIs are available (lax mode only)
  if (!browser?.window || !browser?.document) {
    console.warn('[Tracking Guardian] Meta Pixel requires lax sandbox mode. Use Meta CAPI for strict mode.');
    return;
  }
  
  // Idempotency guard - prevent double initialization
  if (browser.window.__TG_META_LOADED) return;
  browser.window.__TG_META_LOADED = true;

  // Event queue for events fired before SDK loads
  const eventQueue = [];
  let fbqReady = false;

  // Safe fbq wrapper that queues events until ready
  function safeFbq(...args) {
    if (fbqReady && browser.window.fbq) {
      browser.window.fbq(...args);
    } else {
      eventQueue.push(args);
    }
  }

  // Initialize Meta Pixel using browser APIs (sandbox-compatible)
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;
  t.onload=function(){
    fbqReady = true;
    // Flush queued events
    eventQueue.forEach(args => browser.window.fbq(...args));
    eventQueue.length = 0;
  };
  s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(browser.window, browser.document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  
  browser.window.fbq('init', PIXEL_ID);
  browser.window.fbq('track', 'PageView');

  // Track page views
  analytics.subscribe('page_viewed', (event) => {
    safeFbq('track', 'PageView');
  });

  // Track product views
  analytics.subscribe('product_viewed', (event) => {
    const product = event.data?.productVariant;
    if (!product) return;
    
    safeFbq('track', 'ViewContent', {
      content_ids: [product.id],
      content_name: product.title,
      content_type: 'product',
      value: parseFloat(product.price?.amount || '0'),
      currency: product.price?.currencyCode || 'USD',
    });
  });

  // Track add to cart
  analytics.subscribe('product_added_to_cart', (event) => {
    const item = event.data?.cartLine;
    if (!item?.merchandise) return;
    
    safeFbq('track', 'AddToCart', {
      content_ids: [item.merchandise.id],
      content_name: item.merchandise.title,
      content_type: 'product',
      value: parseFloat(item.merchandise.price?.amount || '0') * (item.quantity || 1),
      currency: item.merchandise.price?.currencyCode || 'USD',
    });
  });

  // Track checkout initiated
  analytics.subscribe('checkout_started', (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;
    
    const lineItems = checkout.lineItems || [];
    safeFbq('track', 'InitiateCheckout', {
      content_ids: lineItems.map((item) => item.id),
      contents: lineItems.map((item) => ({
        id: item.id,
        quantity: item.quantity || 1,
      })),
      content_type: 'product',
      value: parseFloat(checkout.totalPrice?.amount || '0'),
      currency: checkout.currencyCode || 'USD',
      num_items: lineItems.reduce((sum, item) => sum + (item.quantity || 1), 0),
    });
  });

  // Track payment info added
  analytics.subscribe('payment_info_submitted', (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;
    
    const lineItems = checkout.lineItems || [];
    safeFbq('track', 'AddPaymentInfo', {
      content_ids: lineItems.map((item) => item.id),
      value: parseFloat(checkout.totalPrice?.amount || '0'),
      currency: checkout.currencyCode || 'USD',
    });
  });

  // Track purchase
  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;
    
    const lineItems = checkout.lineItems || [];
    safeFbq('track', 'Purchase', {
      content_ids: lineItems.map((item) => item.id),
      contents: lineItems.map((item) => ({
        id: item.id,
        quantity: item.quantity || 1,
        item_price: parseFloat(item.variant?.price?.amount || '0'),
      })),
      content_type: 'product',
      value: parseFloat(checkout.totalPrice?.amount || '0'),
      currency: checkout.currencyCode || 'USD',
      order_id: checkout.order?.id || checkout.token,
      num_items: lineItems.reduce((sum, item) => sum + (item.quantity || 1), 0),
    });
  });
});
`;
}

// Helper functions imported from utils/crypto

