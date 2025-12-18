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
 */
export async function sendConversionToMeta(
  credentials: MetaCredentials | null,
  conversionData: ConversionData
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

  const eventPayload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
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
export function generateMetaPixelCode(config: { pixelId: string }): string {
  return `// Meta (Facebook) Pixel - Web Pixel Implementation
// Auto-generated by Tracking Guardian

import {register, analytics} from '@shopify/web-pixels-extension';

register(({analytics, browser, settings}) => {
  const PIXEL_ID = '${config.pixelId}';

  // Initialize Meta Pixel
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  
  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  // Track page views
  analytics.subscribe('page_viewed', (event) => {
    fbq('track', 'PageView');
  });

  // Track product views
  analytics.subscribe('product_viewed', (event) => {
    const product = event.data.productVariant;
    fbq('track', 'ViewContent', {
      content_ids: [product.id],
      content_name: product.title,
      content_type: 'product',
      value: parseFloat(product.price.amount),
      currency: product.price.currencyCode,
    });
  });

  // Track add to cart
  analytics.subscribe('product_added_to_cart', (event) => {
    const item = event.data.cartLine;
    fbq('track', 'AddToCart', {
      content_ids: [item.merchandise.id],
      content_name: item.merchandise.title,
      content_type: 'product',
      value: parseFloat(item.merchandise.price.amount) * item.quantity,
      currency: item.merchandise.price.currencyCode,
    });
  });

  // Track checkout initiated
  analytics.subscribe('checkout_started', (event) => {
    const checkout = event.data.checkout;
    fbq('track', 'InitiateCheckout', {
      content_ids: checkout.lineItems.map((item) => item.id),
      contents: checkout.lineItems.map((item) => ({
        id: item.id,
        quantity: item.quantity,
      })),
      content_type: 'product',
      value: parseFloat(checkout.totalPrice.amount),
      currency: checkout.currencyCode,
      num_items: checkout.lineItems.reduce((sum, item) => sum + item.quantity, 0),
    });
  });

  // Track payment info added
  analytics.subscribe('payment_info_submitted', (event) => {
    const checkout = event.data.checkout;
    fbq('track', 'AddPaymentInfo', {
      content_ids: checkout.lineItems.map((item) => item.id),
      value: parseFloat(checkout.totalPrice.amount),
      currency: checkout.currencyCode,
    });
  });

  // Track purchase
  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data.checkout;
    fbq('track', 'Purchase', {
      content_ids: checkout.lineItems.map((item) => item.id),
      contents: checkout.lineItems.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        item_price: parseFloat(item.variant?.price?.amount || '0'),
      })),
      content_type: 'product',
      value: parseFloat(checkout.totalPrice.amount),
      currency: checkout.currencyCode,
      order_id: checkout.order?.id || checkout.token,
      num_items: checkout.lineItems.reduce((sum, item) => sum + item.quantity, 0),
    });
  });
});
`;
}

// Helper functions imported from utils/crypto

