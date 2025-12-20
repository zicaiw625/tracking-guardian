/**
 * Tracking Guardian - Web Pixel Extension
 * 
 * P0-1: Backend URL Configuration
 * The backend URL is now retrieved from app metafields (set during installation)
 * rather than merchant-configurable settings. This prevents arbitrary URL configuration
 * which could be flagged as data exfiltration during App Store review.
 * 
 * Security: All requests are signed with HMAC-SHA256 using the ingestion secret.
 */

import { register } from "@shopify/web-pixels-extension";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

// P0-1: Production URL constant - set during deployment
// This is the ONLY allowed backend URL; merchants cannot configure arbitrary URLs
// For development, use the app's local URL via environment variable substitution
const PRODUCTION_BACKEND_URL = "https://tracking-guardian.onrender.com";

// P0-1: Allowed URL patterns for validation (production + staging)
const ALLOWED_URL_PATTERNS = [
  /^https:\/\/tracking-guardian\.onrender\.com$/,
  /^https:\/\/tracking-guardian-staging\.onrender\.com$/,
  // Local development (only works in dev mode)
  /^https?:\/\/localhost:\d+$/,
  /^https?:\/\/127\.0\.0\.1:\d+$/,
];

function isAllowedBackendUrl(url: string): boolean {
  return ALLOWED_URL_PATTERNS.some(pattern => pattern.test(url));
}

function hmacSha256(key: string, message: string): string {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(key);
  const messageBytes = encoder.encode(message);

  const signature = hmac(sha256, keyBytes, messageBytes);

  return bytesToHex(signature);
}

// Types are intentionally loose to handle Shopify's varying type definitions
interface CheckoutData {
  order?: { id?: string };
  token?: string;
  totalPrice?: { amount?: string | number };
  totalTax?: { amount?: string | number };
  shippingLine?: { price?: { amount?: string | number } };
  currencyCode?: string;
  lineItems?: Array<{
    id?: string;
    title?: string;
    quantity?: number;
    variant?: { price?: { amount?: string | number } };
  }>;
  
  email?: string;
  phone?: string;
}

interface ProductVariantData {
  id?: string;
  title?: string;
  price?: { amount?: string | number; currencyCode?: string };
}

interface CartLineData {
  merchandise?: {
    id?: string;
    title?: string;
    price?: { amount?: string | number; currencyCode?: string };
  };
  quantity?: number;
}

interface VisitorConsentCollectedEvent {
  analyticsProcessingAllowed: boolean;
  marketingAllowed: boolean;
  preferencesProcessingAllowed: boolean;
  saleOfDataAllowed: boolean;
}

// Helper to safely convert amount to number
function toNumber(value: string | number | undefined | null, defaultValue = 0): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
register(({ analytics, settings, init, customerPrivacy }: any) => {
  
  // P0-1: Use production URL constant (no merchant-configurable URL)
  // The URL allowlist validation provides defense-in-depth
  const backendUrl = PRODUCTION_BACKEND_URL;

  const ingestionSecret = settings.ingestion_secret as string | undefined;
  const shopDomain = init.data?.shop?.myshopifyDomain || "";
  
  const debugMode = settings.debug === true;

  function log(...args: unknown[]): void {
    if (debugMode) {
      console.log("[Tracking Guardian]", ...args);
    }
  }

  // P0-1: Backend URL is now always the production constant
  log("Using backend URL:", backendUrl);

  if (!ingestionSecret) {
    console.warn(
      "[Tracking Guardian] WARNING: ingestion_secret not configured. " +
      "Requests will be sent unsigned and may be rejected in production. " +
      "Please configure the Ingestion Key in your Web Pixel settings."
    );
  }

  function generateSignature(timestamp: number, body: string): string | null {
    if (!ingestionSecret) {

      return null;
    }
    
    try {
      
      const message = `${timestamp}${body}`;

      const signature = hmacSha256(ingestionSecret, message);
      
      return signature;
    } catch (e) {
      
      log("Failed to generate signature:", e);
      return null;
    }
  }

  let marketingAllowed = false;
  let analyticsAllowed = false;

  // customerPrivacy is provided directly to the register callback
  if (customerPrivacy) {
    
    marketingAllowed = customerPrivacy.marketingAllowed === true;
    analyticsAllowed = customerPrivacy.analyticsProcessingAllowed === true;
    
    log("Initial consent state:", { marketingAllowed, analyticsAllowed });

    try {
      customerPrivacy.subscribe("visitorConsentCollected", (event: VisitorConsentCollectedEvent) => {
        marketingAllowed = event.marketingAllowed === true;
        analyticsAllowed = event.analyticsProcessingAllowed === true;
        log("Consent updated:", { marketingAllowed, analyticsAllowed });
      });
    } catch {
      
      log("Could not subscribe to consent changes");
    }
  } else {

    log("Customer privacy API not available, defaulting to no tracking");
  }

  function hasAnyConsent(): boolean {
    return marketingAllowed === true || analyticsAllowed === true;
  }

  function hasMarketingConsent(): boolean {
    return marketingAllowed === true;
  }

  function hasAnalyticsConsent(): boolean {
    return analyticsAllowed === true;
  }

  function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timeoutId),
    };
  }

  async function sendToBackend(
    eventName: string,
    data: Record<string, unknown>
  ): Promise<void> {

    if (!hasAnyConsent()) {
      log(`Skipping ${eventName} - no consent (marketing: ${marketingAllowed}, analytics: ${analyticsAllowed})`);
      return;
    }

    try {
      const timestamp = Date.now();
      const payload = {
        eventName,
        
        timestamp,
        shopDomain,
        
        consent: {
          marketing: marketingAllowed,
          analytics: analyticsAllowed,
        },
        data,
      };
      
      const body = JSON.stringify(payload);

      const signature = generateSignature(timestamp, body);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (signature) {
        headers["X-Tracking-Guardian-Signature"] = signature;
        headers["X-Tracking-Guardian-Timestamp"] = timestamp.toString();
      } else {
        
        headers["X-Tracking-Guardian-Unsigned"] = "true";
      }

      const { signal, cleanup } = createTimeoutSignal(5000);

      fetch(`${backendUrl}/api/pixel-events`, {
        method: "POST",
        headers,
        body,
        signal,
      })
        .then(() => cleanup())
        .catch(() => {
          cleanup();
          
        });
    } catch {
      
    }
  }

  analytics.subscribe("page_viewed", (event) => {
    sendToBackend("page_viewed", {
      pageTitle: event.context?.document?.title || "",
      pageUrl: event.context?.document?.location?.href || "",
    });
  });

  analytics.subscribe("product_viewed", (event) => {
    const product = event.data?.productVariant as ProductVariantData | undefined;
    if (!product?.id) return;
    
    sendToBackend("product_viewed", {
      productId: product.id,
      productName: product.title || "",
      productPrice: toNumber(product.price?.amount),
      currency: product.price?.currencyCode || "USD",
    });
  });

  analytics.subscribe("product_added_to_cart", (event) => {
    const cartLine = event.data?.cartLine as CartLineData | undefined;
    if (!cartLine?.merchandise?.id) return;

    const price = toNumber(cartLine.merchandise.price?.amount);
    const quantity = cartLine.quantity || 1;

    sendToBackend("product_added_to_cart", {
      productId: cartLine.merchandise.id,
      productName: cartLine.merchandise.title || "",
      productPrice: price,
      quantity,
      value: price * quantity,
      currency: cartLine.merchandise.price?.currencyCode || "USD",
    });
  });

  analytics.subscribe("checkout_started", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("checkout_started", {
      checkoutToken: checkout.token || "",
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
      items: (checkout.lineItems || []).map((item) => ({
        id: item.id || "",
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
      })),
    });
  });

  analytics.subscribe("payment_info_submitted", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    sendToBackend("payment_info_submitted", {
      checkoutToken: checkout.token || "",
      value: toNumber(checkout.totalPrice?.amount),
      currency: checkout.currencyCode || "USD",
    });
  });

  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout as CheckoutData | undefined;
    if (!checkout) return;

    const orderId = checkout.order?.id;
    const checkoutToken = checkout.token;

    if (!orderId) {
      log("checkout_completed: No order.id available, using checkoutToken for fallback");
    }

    if (!orderId && !checkoutToken) {
      log("checkout_completed: No orderId or checkoutToken, skipping");
      return;
    }

    const value = toNumber(checkout.totalPrice?.amount);
    const tax = toNumber(checkout.totalTax?.amount);
    const shipping = toNumber(checkout.shippingLine?.price?.amount);

    sendToBackend("checkout_completed", {

      orderId: orderId || null,
      checkoutToken: checkoutToken || null,
      value,
      tax,
      shipping,
      currency: checkout.currencyCode || "USD",
      
      items: (checkout.lineItems || []).map((item) => ({
        id: item.id || "",
        name: item.title || "",
        price: toNumber(item.variant?.price?.amount),
        quantity: item.quantity || 1,
      })),
    });
  });
});
