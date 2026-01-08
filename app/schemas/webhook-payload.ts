import { z } from 'zod';

export const MoneySchema = z.object({
  amount: z.string(),
  currency_code: z.string().optional(),
});

export const ShippingPriceSetSchema = z.object({
  shop_money: MoneySchema.optional(),
  presentment_money: MoneySchema.optional(),
});

export const GDPRCustomerSchema = z.object({
  id: z.number().optional(),

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
