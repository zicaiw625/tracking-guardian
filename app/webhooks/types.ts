/**
 * Webhook Types
 *
 * Type definitions for webhook handling.
 */

import type { Shop, PixelConfig } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// =============================================================================
// Webhook Context
// =============================================================================

/**
 * Context passed to webhook handlers
 */
export interface WebhookContext {
  /** Shop domain (e.g., "myshop.myshopify.com") */
  shop: string;
  /** Webhook topic (e.g., "ORDERS_PAID") */
  topic: string;
  /** Webhook ID from X-Shopify-Webhook-Id header */
  webhookId: string | null;
  /** Raw webhook payload */
  payload: unknown;
  /** Admin API client (null if shop uninstalled) */
  admin: AdminApiContext | null;
  /** Session object (if available) */
  session: unknown;
}

/**
 * Shop record with pixel configs
 */
export interface ShopWithPixelConfigs extends Shop {
  pixelConfigs: PixelConfig[];
}

// =============================================================================
// Handler Result
// =============================================================================

/**
 * Result of processing a webhook
 */
export interface WebhookHandlerResult {
  success: boolean;
  status: number;
  message: string;
  /** Order ID if applicable */
  orderId?: string;
}

/**
 * Webhook handler function type
 */
export type WebhookHandler = (
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
) => Promise<WebhookHandlerResult>;

// =============================================================================
// Idempotency
// =============================================================================

/**
 * Result of attempting to acquire webhook lock
 */
export interface WebhookLockResult {
  acquired: boolean;
  existing?: boolean;
}

// =============================================================================
// GDPR Types
// =============================================================================

export type GDPRJobType = "data_request" | "customer_redact" | "shop_redact";

