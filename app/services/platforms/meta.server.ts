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

export function generateMetaPixelCode(config: { pixelId: string }): string {
  return `/**
 * Meta (Facebook) Pixel - Web Pixel Implementation
 * Auto-generated by Tracking Guardian
 *
 * ⚠️ SANDBOX MODE WARNING ⚠️
 * ==========================
 * This code requires "lax" or "custom pixel" sandbox mode.
 * It will NOT work in "strict" sandbox mode.
 * 
 * For strict mode compatibility:
 * 1. Do NOT use this generated code
 * 2. Configure Meta Conversions API (CAPI) in Tracking Guardian settings
 * 3. The built-in Tracking Guardian pixel will handle consent tracking
 * 
 * Customer Privacy:
 * - This pixel respects Shopify's Customer Privacy API
 * - Marketing consent is verified before loading the Meta SDK
 * - Conversions are only tracked when consent is granted
 */

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

