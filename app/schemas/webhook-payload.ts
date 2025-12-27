

import { z } from 'zod';

export const MoneySchema = z.object({
  amount: z.string(),
  currency_code: z.string().optional(),
});

export const ShippingPriceSetSchema = z.object({
  shop_money: MoneySchema.optional(),
  presentment_money: MoneySchema.optional(),
});

export const AddressSchema = z.object({
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  address1: z.string().nullable().optional(),
  address2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  province_code: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
}).passthrough();

export const CustomerSchema = z.object({
  id: z.number().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  default_address: AddressSchema.nullable().optional(),
}).passthrough();

export const OrderLineItemSchema = z.object({
  id: z.number().optional(),
  product_id: z.number().nullable().optional(),
  variant_id: z.number().nullable().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  sku: z.string().nullable().optional(),
  quantity: z.number().int().positive().optional(),
  price: z.string().optional(),
  grams: z.number().optional(),
  vendor: z.string().nullable().optional(),
  properties: z.array(z.object({
    name: z.string(),
    value: z.unknown(),
  })).optional(),
}).passthrough();

export const OrderWebhookPayloadSchema = z.object({

  id: z.number(),

  order_number: z.number().nullable().optional(),
  name: z.string().optional(),
  checkout_token: z.string().nullable().optional(),

  total_price: z.string().optional(),
  subtotal_price: z.string().optional(),
  total_tax: z.string().optional(),
  total_discounts: z.string().optional(),
  currency: z.string().length(3).optional(),
  total_shipping_price_set: ShippingPriceSetSchema.nullable().optional(),

  financial_status: z.string().optional(),
  fulfillment_status: z.string().nullable().optional(),

  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  customer: CustomerSchema.nullable().optional(),

  billing_address: AddressSchema.nullable().optional(),
  shipping_address: AddressSchema.nullable().optional(),

  line_items: z.array(OrderLineItemSchema).optional(),

  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  processed_at: z.string().optional(),
  closed_at: z.string().nullable().optional(),
  cancelled_at: z.string().nullable().optional(),

  note: z.string().nullable().optional(),
  tags: z.string().optional(),
  test: z.boolean().optional(),
  gateway: z.string().nullable().optional(),
  confirmed: z.boolean().optional(),
  source_name: z.string().optional(),
  browser_ip: z.string().nullable().optional(),
  landing_site: z.string().nullable().optional(),
  referring_site: z.string().nullable().optional(),

  discount_codes: z.array(z.object({
    code: z.string(),
    amount: z.string(),
    type: z.string(),
  })).optional(),
}).passthrough();

export type OrderWebhookPayloadInput = z.infer<typeof OrderWebhookPayloadSchema>;

export const GDPRCustomerSchema = z.object({
  id: z.number().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export const GDPRDataRequestPayloadSchema = z.object({
  shop_id: z.number(),
  shop_domain: z.string(),
  orders_requested: z.array(z.number()).optional(),
  customer: GDPRCustomerSchema.optional(),
  data_request: z.object({
    id: z.number(),
  }).optional(),
}).passthrough();

export type GDPRDataRequestPayloadInput = z.infer<typeof GDPRDataRequestPayloadSchema>;

export const GDPRCustomerRedactPayloadSchema = z.object({
  shop_id: z.number(),
  shop_domain: z.string(),
  customer: GDPRCustomerSchema,
  orders_to_redact: z.array(z.number()).optional(),
}).passthrough();

export type GDPRCustomerRedactPayloadInput = z.infer<typeof GDPRCustomerRedactPayloadSchema>;

export const GDPRShopRedactPayloadSchema = z.object({
  shop_id: z.number(),
  shop_domain: z.string(),
}).passthrough();

export type GDPRShopRedactPayloadInput = z.infer<typeof GDPRShopRedactPayloadSchema>;

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; issues?: z.ZodIssue[] };

export function validateOrderPayload(payload: unknown): ValidationResult<OrderWebhookPayloadInput> {
  const result = OrderWebhookPayloadSchema.safeParse(payload);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: result.error.issues[0]?.message || 'Invalid order payload',
    issues: result.error.issues,
  };
}

export function validateGDPRDataRequest(payload: unknown): ValidationResult<GDPRDataRequestPayloadInput> {
  const result = GDPRDataRequestPayloadSchema.safeParse(payload);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: result.error.issues[0]?.message || 'Invalid GDPR data request payload',
    issues: result.error.issues,
  };
}

export function validateGDPRCustomerRedact(payload: unknown): ValidationResult<GDPRCustomerRedactPayloadInput> {
  const result = GDPRCustomerRedactPayloadSchema.safeParse(payload);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: result.error.issues[0]?.message || 'Invalid GDPR customer redact payload',
    issues: result.error.issues,
  };
}

export function validateGDPRShopRedact(payload: unknown): ValidationResult<GDPRShopRedactPayloadInput> {
  const result = GDPRShopRedactPayloadSchema.safeParse(payload);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: result.error.issues[0]?.message || 'Invalid GDPR shop redact payload',
    issues: result.error.issues,
  };
}

export function extractOrderId(payload: OrderWebhookPayloadInput): string {
  return String(payload.id);
}

export function extractCustomerEmail(payload: OrderWebhookPayloadInput): string | null {
  return payload.email || payload.customer?.email || null;
}

export function extractCustomerPhone(payload: OrderWebhookPayloadInput): string | null {
  return payload.phone || payload.customer?.phone || null;
}

export function calculateOrderValue(payload: OrderWebhookPayloadInput): number {
  return parseFloat(payload.total_price || '0');
}

export function getShippingAmount(payload: OrderWebhookPayloadInput): number {
  return parseFloat(payload.total_shipping_price_set?.shop_money?.amount || '0');
}

export function isTestOrder(payload: OrderWebhookPayloadInput): boolean {
  return payload.test === true;
}

