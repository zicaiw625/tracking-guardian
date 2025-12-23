/**
 * Pixel Event Validation Schemas
 * 
 * Zod schemas for validating pixel event payloads from the Web Pixel extension.
 * These schemas provide type-safe validation with detailed error messages.
 */

import { z } from 'zod';

// =============================================================================
// Constants for Validation
// =============================================================================

/**
 * Minimum reasonable timestamp (2020-01-01).
 * Rejects obviously invalid timestamps like Unix epoch.
 */
export const MIN_REASONABLE_TIMESTAMP = 1577836800000;

/**
 * Maximum future timestamp (24 hours from now).
 * Rejects timestamps set too far in the future.
 */
export const MAX_FUTURE_TIMESTAMP_OFFSET_MS = 86400000;

/**
 * Checkout token format validation.
 * Shopify checkout tokens are alphanumeric with dashes and underscores.
 */
const CHECKOUT_TOKEN_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CHECKOUT_TOKEN_MIN_LENGTH = 8;
const CHECKOUT_TOKEN_MAX_LENGTH = 128;

/**
 * Order ID format validation.
 * Accepts numeric IDs or Shopify GID format.
 */
const ORDER_ID_PATTERN = /^(gid:\/\/shopify\/Order\/)?(\d+)$/;

/**
 * Shop domain format validation.
 * Must be a valid myshopify.com domain.
 */
const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

// =============================================================================
// Common Schemas
// =============================================================================

/**
 * Consent state schema from Shopify Customer Privacy API.
 */
export const ConsentSchema = z.object({
  marketing: z.boolean().optional(),
  analytics: z.boolean().optional(),
  saleOfData: z.boolean().optional(),
}).strict();

export type ConsentInput = z.infer<typeof ConsentSchema>;

/**
 * Line item schema for checkout events.
 */
export const LineItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  price: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  sku: z.string().optional(),
  productId: z.string().optional(),
  variantId: z.string().optional(),
});

export type LineItemInput = z.infer<typeof LineItemSchema>;

// =============================================================================
// Event-Specific Data Schemas
// =============================================================================

/**
 * Checkout token validation.
 */
export const CheckoutTokenSchema = z.string()
  .min(CHECKOUT_TOKEN_MIN_LENGTH, 'Checkout token too short')
  .max(CHECKOUT_TOKEN_MAX_LENGTH, 'Checkout token too long')
  .regex(CHECKOUT_TOKEN_PATTERN, 'Invalid checkout token format');

/**
 * Order ID validation.
 */
export const OrderIdSchema = z.string()
  .regex(ORDER_ID_PATTERN, 'Invalid order ID format');

/**
 * Checkout completed event data schema.
 */
export const CheckoutCompletedDataSchema = z.object({
  orderId: z.union([z.string(), z.null()]).optional(),
  orderNumber: z.string().optional(),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  tax: z.number().nonnegative().optional(),
  shipping: z.number().nonnegative().optional(),
  checkoutToken: z.union([z.string(), z.null()]).optional(),
  items: z.array(LineItemSchema).optional(),
  itemCount: z.number().int().nonnegative().optional(),
  url: z.string().url().optional(),
  title: z.string().optional(),
}).refine(
  (data) => data.orderId || data.checkoutToken,
  { message: 'Either orderId or checkoutToken is required for checkout_completed' }
);

export type CheckoutCompletedDataInput = z.infer<typeof CheckoutCompletedDataSchema>;

/**
 * Page view event data schema.
 */
export const PageViewDataSchema = z.object({
  url: z.string().url().optional(),
  title: z.string().optional(),
  productId: z.string().optional(),
  productTitle: z.string().optional(),
  price: z.number().nonnegative().optional(),
});

export type PageViewDataInput = z.infer<typeof PageViewDataSchema>;

/**
 * Add to cart event data schema.
 */
export const AddToCartDataSchema = z.object({
  productId: z.string().optional(),
  productTitle: z.string().optional(),
  variantId: z.string().optional(),
  price: z.number().nonnegative().optional(),
  quantity: z.number().int().positive().optional(),
  currency: z.string().length(3).optional(),
});

export type AddToCartDataInput = z.infer<typeof AddToCartDataSchema>;

// =============================================================================
// Event Type Enum
// =============================================================================

/**
 * Supported pixel event types.
 */
export const PixelEventNameSchema = z.enum([
  'checkout_completed',
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'page_viewed',
  'product_added_to_cart',
]);

export type PixelEventName = z.infer<typeof PixelEventNameSchema>;

// =============================================================================
// Main Event Schema
// =============================================================================

/**
 * Create a timestamp validator that checks against current time.
 */
function createTimestampSchema() {
  return z.number()
    .int()
    .min(MIN_REASONABLE_TIMESTAMP, 'Timestamp is before 2020')
    .refine(
      (ts) => ts <= Date.now() + MAX_FUTURE_TIMESTAMP_OFFSET_MS,
      'Timestamp is too far in the future'
    );
}

/**
 * Shop domain validation schema.
 */
export const ShopDomainSchema = z.string()
  .regex(SHOP_DOMAIN_PATTERN, 'Invalid shop domain format');

/**
 * Base pixel event schema (without event-specific data).
 */
const BasePixelEventSchema = z.object({
  eventName: PixelEventNameSchema,
  timestamp: createTimestampSchema(),
  shopDomain: ShopDomainSchema,
  consent: ConsentSchema.optional(),
});

/**
 * Full pixel event schema with event-specific data validation.
 * 
 * Uses discriminated union based on eventName to validate the data field
 * appropriately for each event type.
 */
export const PixelEventSchema = z.discriminatedUnion('eventName', [
  BasePixelEventSchema.extend({
    eventName: z.literal('checkout_completed'),
    data: CheckoutCompletedDataSchema,
  }),
  BasePixelEventSchema.extend({
    eventName: z.literal('checkout_started'),
    data: z.object({
      value: z.number().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      checkoutToken: z.string().optional(),
      items: z.array(LineItemSchema).optional(),
    }).optional(),
  }),
  BasePixelEventSchema.extend({
    eventName: z.literal('checkout_contact_info_submitted'),
    data: z.object({}).optional(),
  }),
  BasePixelEventSchema.extend({
    eventName: z.literal('checkout_shipping_info_submitted'),
    data: z.object({}).optional(),
  }),
  BasePixelEventSchema.extend({
    eventName: z.literal('payment_info_submitted'),
    data: z.object({}).optional(),
  }),
  BasePixelEventSchema.extend({
    eventName: z.literal('page_viewed'),
    data: PageViewDataSchema.optional(),
  }),
  BasePixelEventSchema.extend({
    eventName: z.literal('product_added_to_cart'),
    data: AddToCartDataSchema.optional(),
  }),
]);

export type PixelEventInput = z.infer<typeof PixelEventSchema>;

/**
 * Simple pixel event schema for initial validation.
 * Use this for quick validation before detailed event-specific validation.
 */
export const SimplePixelEventSchema = z.object({
  eventName: z.string().min(1),
  timestamp: z.number().int(),
  shopDomain: z.string().min(1),
  consent: z.object({
    marketing: z.boolean().optional(),
    analytics: z.boolean().optional(),
    saleOfData: z.boolean().optional(),
  }).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type SimplePixelEventInput = z.infer<typeof SimplePixelEventSchema>;

// =============================================================================
// Validation Helper Functions
// =============================================================================

/**
 * Validation result type.
 */
export type ValidationResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string; code: string; issues?: z.ZodIssue[] };

/**
 * Validate a pixel event payload.
 * Returns a discriminated union for easy handling.
 */
export function validatePixelEvent(payload: unknown): ValidationResult<PixelEventInput> {
  const result = PixelEventSchema.safeParse(payload);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const firstError = result.error.issues[0];
  const code = mapZodErrorToCode(firstError);
  
  return {
    success: false,
    error: firstError.message,
    code,
    issues: result.error.issues,
  };
}

/**
 * Validate a simple pixel event (minimal validation).
 */
export function validateSimplePixelEvent(payload: unknown): ValidationResult<SimplePixelEventInput> {
  const result = SimplePixelEventSchema.safeParse(payload);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const firstError = result.error.issues[0];
  const code = mapZodErrorToCode(firstError);
  
  return {
    success: false,
    error: firstError.message,
    code,
    issues: result.error.issues,
  };
}

/**
 * Validate checkout completed data specifically.
 */
export function validateCheckoutCompletedData(data: unknown): ValidationResult<CheckoutCompletedDataInput> {
  const result = CheckoutCompletedDataSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const firstError = result.error.issues[0];
  const code = mapZodErrorToCode(firstError);
  
  return {
    success: false,
    error: firstError.message,
    code,
    issues: result.error.issues,
  };
}

/**
 * Validate consent object.
 */
export function validateConsent(consent: unknown): ValidationResult<ConsentInput> {
  const result = ConsentSchema.safeParse(consent);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return {
    success: false,
    error: result.error.issues[0].message,
    code: 'invalid_consent_format',
    issues: result.error.issues,
  };
}

/**
 * Map Zod error to a standardized error code.
 */
function mapZodErrorToCode(error: z.ZodIssue): string {
  const path = error.path.join('.');
  // Cast to string to handle Zod version differences
  const code = error.code as string;
  
  if (code === 'invalid_type') {
    if (path === 'eventName') return 'missing_event_name';
    if (path === 'shopDomain') return 'missing_shop_domain';
    if (path === 'timestamp') return 'missing_timestamp';
    return `invalid_${path}_type`;
  }
  
  // Handle string validation errors (Zod 4.x uses invalid_format)
  if (code === 'invalid_format' || code === 'invalid_string') {
    if (path === 'shopDomain') return 'invalid_shop_domain_format';
    if (path.includes('checkoutToken')) return 'invalid_checkout_token_format';
    if (path.includes('orderId')) return 'invalid_order_id_format';
    return `invalid_${path}_format`;
  }
  
  if (code === 'too_small' || code === 'too_big') {
    if (path === 'timestamp') return 'invalid_timestamp_value';
    return `invalid_${path}_range`;
  }
  
  if (code === 'custom') {
    if (error.message.includes('orderId') || error.message.includes('checkoutToken')) {
      return 'missing_order_identifiers';
    }
    return 'validation_error';
  }
  
  return 'invalid_body';
}

/**
 * Check if event is a primary event (that triggers CAPI).
 */
export function isPrimaryEvent(eventName: string): boolean {
  return eventName === 'checkout_completed';
}

/**
 * Check if consent allows any tracking.
 */
export function hasAnyConsent(consent: ConsentInput | undefined): boolean {
  if (!consent) return false;
  return consent.marketing === true || consent.analytics === true;
}

