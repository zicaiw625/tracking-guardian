

import { z } from 'zod';

export const MoneySchema = z.object({
  amount: z.string(),
  currency_code: z.string().optional(),
});

export const ShippingPriceSetSchema = z.object({
  shop_money: MoneySchema.optional(),
  presentment_money: MoneySchema.optional(),
});

// P0-2: v1.0 版本不包含任何 PCD/PII 处理，因此移除所有 Order webhook 相关的 schema
// v1.0 仅依赖 Web Pixels 标准事件，不处理订单 webhooks
// 已移除：AddressSchema, CustomerSchema, OrderLineItemSchema, OrderWebhookPayloadSchema, OrderWebhookPayloadInput

// P0-3: v1.0 版本最小化 GDPR schema，只保留处理 GDPR webhook 必需的字段
// v1.0 仅依赖 Web Pixels 标准事件，不处理任何客户数据
// GDPR webhook 处理只需要 customer.id 来标识要删除的客户，不需要 email/phone
export const GDPRCustomerSchema = z.object({
  id: z.number().optional(),
  // P0-3: v1.0 版本移除 email 和 phone 字段，只保留 id
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

// P0-2: v1.0 版本不包含任何 PCD/PII 处理，因此移除 validateOrderPayload 函数
// v1.0 仅依赖 Web Pixels 标准事件，不处理订单 webhooks

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

// P0-2: v1.0 版本不包含任何 PCD/PII 处理，因此移除所有 Order webhook 相关函数
// v1.0 仅依赖 Web Pixels 标准事件，不处理订单 webhooks
// 已移除：extractOrderId, extractCustomerEmail, extractCustomerPhone, calculateOrderValue, getShippingAmount, isTestOrder

