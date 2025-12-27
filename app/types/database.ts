

import type {
  JobStatusType,
  TrustLevelType,
  SignatureStatusType,
  PlatformType,
  ConsentStrategyType,
} from './enums';
import { ok, err, type Result } from './result';

export interface CapiLineItem {
  productId?: string;
  variantId?: string;
  sku?: string;
  name: string;
  quantity: number;
  price: number;
}

export interface HashedUserDataJson {
  em?: string;
  ph?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  st?: string;
  country?: string;
  zp?: string;
}

export interface CapiInputJson {
  orderId: string;
  value: number;
  currency: string;
  orderNumber?: string | null;
  items?: CapiLineItem[];
  contentIds?: string[];
  numItems?: number;
  tax?: number;
  shipping?: number;
  processedAt?: string;
  webhookReceivedAt?: string;
  checkoutToken?: string | null;
  shopifyOrderId?: number | string;

  hashedUserData?: HashedUserDataJson | null;
}

export function parseCapiInput(json: unknown): CapiInputJson | null {
  if (!json || typeof json !== 'object') {
    return null;
  }

  const data = json as Record<string, unknown>;

  if (typeof data.orderId !== 'string' || typeof data.value !== 'number') {
    return null;
  }

  return {
    orderId: data.orderId,
    value: data.value,
    currency: typeof data.currency === 'string' ? data.currency : 'USD',
    orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : null,
    items: Array.isArray(data.items) ? data.items.map(parseCapiLineItem).filter(Boolean) as CapiLineItem[] : undefined,
    contentIds: Array.isArray(data.contentIds) ? data.contentIds.filter((id): id is string => typeof id === 'string') : undefined,
    numItems: typeof data.numItems === 'number' ? data.numItems : undefined,
    tax: typeof data.tax === 'number' ? data.tax : undefined,
    shipping: typeof data.shipping === 'number' ? data.shipping : undefined,
    processedAt: typeof data.processedAt === 'string' ? data.processedAt : undefined,
    webhookReceivedAt: typeof data.webhookReceivedAt === 'string' ? data.webhookReceivedAt : undefined,
    checkoutToken: typeof data.checkoutToken === 'string' ? data.checkoutToken : null,
    shopifyOrderId: typeof data.shopifyOrderId === 'number' || typeof data.shopifyOrderId === 'string'
      ? data.shopifyOrderId
      : undefined,

    hashedUserData: parseHashedUserData(data.hashedUserData),
  };
}

function parseHashedUserData(json: unknown): HashedUserDataJson | null {
  if (!json || typeof json !== 'object') {
    return null;
  }

  const data = json as Record<string, unknown>;
  const result: HashedUserDataJson = {};

  if (typeof data.em === 'string' && data.em) result.em = data.em;
  if (typeof data.ph === 'string' && data.ph) result.ph = data.ph;
  if (typeof data.fn === 'string' && data.fn) result.fn = data.fn;
  if (typeof data.ln === 'string' && data.ln) result.ln = data.ln;
  if (typeof data.ct === 'string' && data.ct) result.ct = data.ct;
  if (typeof data.st === 'string' && data.st) result.st = data.st;
  if (typeof data.country === 'string' && data.country) result.country = data.country;
  if (typeof data.zp === 'string' && data.zp) result.zp = data.zp;

  return Object.keys(result).length > 0 ? result : null;
}

function parseCapiLineItem(item: unknown): CapiLineItem | null {
  if (!item || typeof item !== 'object') return null;
  const data = item as Record<string, unknown>;

  return {
    productId: typeof data.productId === 'string' ? data.productId : undefined,
    variantId: typeof data.variantId === 'string' ? data.variantId : undefined,
    sku: typeof data.sku === 'string' ? data.sku : undefined,
    name: typeof data.name === 'string' ? data.name : '',
    quantity: typeof data.quantity === 'number' ? data.quantity : 1,
    price: typeof data.price === 'number' ? data.price : 0,
  };
}

export interface ConsentStateJson {
  marketing?: boolean;
  analytics?: boolean;
  saleOfData?: boolean;
}

export function parseConsentState(json: unknown): ConsentStateJson | null {
  if (!json || typeof json !== 'object') {
    return null;
  }

  const data = json as Record<string, unknown>;

  return {
    marketing: typeof data.marketing === 'boolean' ? data.marketing : undefined,
    analytics: typeof data.analytics === 'boolean' ? data.analytics : undefined,
    saleOfData: typeof data.saleOfData === 'boolean' ? data.saleOfData : undefined,
  };
}

export interface ConsentEvidenceJson {
  strategy: ConsentStrategyType;
  hasReceipt: boolean;
  receiptTrusted: boolean;
  trustLevel: TrustLevelType;
  consentState: ConsentStateJson | null;
  usedConsent?: string;
  reason?: string;
}

export function parseConsentEvidence(json: unknown): ConsentEvidenceJson | null {
  if (!json || typeof json !== 'object') {
    return null;
  }

  const data = json as Record<string, unknown>;

  return {
    strategy: (data.strategy as ConsentStrategyType) || 'strict',
    hasReceipt: data.hasReceipt === true,
    receiptTrusted: data.receiptTrusted === true,
    trustLevel: (data.trustLevel as TrustLevelType) || 'unknown',
    consentState: parseConsentState(data.consentState),
    usedConsent: typeof data.usedConsent === 'string' ? data.usedConsent : undefined,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
  };
}

export interface TrustMetadataJson {
  trustLevel: TrustLevelType;
  reason?: string;
  verifiedAt?: string;
  hasReceipt?: boolean;
  receiptTrustLevel?: string;
  webhookHasCheckoutToken?: boolean;
  checkoutTokenMatched?: boolean;
  originValidated?: boolean;
}

export function parseTrustMetadata(json: unknown): TrustMetadataJson | null {
  if (!json || typeof json !== 'object') {
    return null;
  }

  const data = json as Record<string, unknown>;

  return {
    trustLevel: (data.trustLevel as TrustLevelType) || 'unknown',
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    verifiedAt: typeof data.verifiedAt === 'string' ? data.verifiedAt : undefined,
    hasReceipt: typeof data.hasReceipt === 'boolean' ? data.hasReceipt : undefined,
    receiptTrustLevel: typeof data.receiptTrustLevel === 'string' ? data.receiptTrustLevel : undefined,
    webhookHasCheckoutToken: typeof data.webhookHasCheckoutToken === 'boolean' ? data.webhookHasCheckoutToken : undefined,
    checkoutTokenMatched: typeof data.checkoutTokenMatched === 'boolean' ? data.checkoutTokenMatched : undefined,
    originValidated: typeof data.originValidated === 'boolean' ? data.originValidated : undefined,
  };
}

export type PlatformResultsJson = Record<PlatformType | string, string>;

export function parsePlatformResults(json: unknown): PlatformResultsJson {
  if (!json || typeof json !== 'object') {
    return {};
  }

  const data = json as Record<string, unknown>;
  const results: PlatformResultsJson = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      results[key] = value;
    }
  }

  return results;
}

export interface EmailAlertSettingsJson {
  email: string;
  emailMasked?: string;
}

export interface SlackAlertSettingsJson {
  webhookUrl: string;
  configured?: boolean;
}

export interface TelegramAlertSettingsJson {
  botToken: string;
  chatId: string;
  botTokenMasked?: string;
}

export type AlertSettingsJson =
  | EmailAlertSettingsJson
  | SlackAlertSettingsJson
  | TelegramAlertSettingsJson;

export interface PixelClientConfigJson {
  treatAsMarketing?: boolean;
  conversionLabels?: string[];
  eventMappings?: Record<string, string>;
}

export function parsePixelClientConfig(json: unknown): PixelClientConfigJson | null {
  if (!json || typeof json !== 'object') {
    return null;
  }

  const data = json as Record<string, unknown>;

  return {
    treatAsMarketing: typeof data.treatAsMarketing === 'boolean' ? data.treatAsMarketing : undefined,
    conversionLabels: Array.isArray(data.conversionLabels)
      ? data.conversionLabels.filter((l): l is string => typeof l === 'string')
      : undefined,
    eventMappings: data.eventMappings && typeof data.eventMappings === 'object'
      ? data.eventMappings as Record<string, string>
      : undefined,
  };
}

export interface RiskItemJson {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  platform?: string;
  recommendation?: string;
}

export function parseRiskItems(json: unknown): RiskItemJson[] {
  if (!Array.isArray(json)) {
    return [];
  }

  return json
    .filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object'
    )
    .map(item => ({
      id: typeof item.id === 'string' ? item.id : '',
      severity: ['low', 'medium', 'high', 'critical'].includes(item.severity as string)
        ? item.severity as RiskItemJson['severity']
        : 'low',
      title: typeof item.title === 'string' ? item.title : '',
      description: typeof item.description === 'string' ? item.description : '',
      platform: typeof item.platform === 'string' ? item.platform : undefined,
      recommendation: typeof item.recommendation === 'string' ? item.recommendation : undefined,
    }))
    .filter(item => item.id && item.title);
}

export function parseIdentifiedPlatforms(json: unknown): string[] {
  if (!Array.isArray(json)) {
    return [];
  }

  return json.filter((p): p is string => typeof p === 'string');
}

export interface PlatformResponseJson {
  success?: boolean;
  events_received?: number;
  fbtrace_id?: string;
  conversionId?: string;
  timestamp?: string;
  error?: {
    code?: number | string;
    message?: string;
  };
}

export function parsePlatformResponse(json: unknown): PlatformResponseJson | null {
  if (!json || typeof json !== 'object') {
    return null;
  }

  const data = json as Record<string, unknown>;

  return {
    success: typeof data.success === 'boolean' ? data.success : undefined,
    events_received: typeof data.events_received === 'number' ? data.events_received : undefined,
    fbtrace_id: typeof data.fbtrace_id === 'string' ? data.fbtrace_id : undefined,
    conversionId: typeof data.conversionId === 'string' ? data.conversionId : undefined,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : undefined,
    error: data.error && typeof data.error === 'object'
      ? {
          code: typeof (data.error as Record<string, unknown>).code === 'number' || typeof (data.error as Record<string, unknown>).code === 'string'
            ? (data.error as Record<string, unknown>).code as number | string
            : undefined,
          message: typeof (data.error as Record<string, unknown>).message === 'string'
            ? (data.error as Record<string, unknown>).message as string
            : undefined,
        }
      : undefined,
  };
}

export interface AuditMetadataJson {
  [key: string]: unknown;
}

export function isCapiInputJson(json: unknown): json is CapiInputJson {
  return parseCapiInput(json) !== null;
}

export function isConsentStateJson(json: unknown): json is ConsentStateJson {
  if (!json || typeof json !== 'object') return false;
  const data = json as Record<string, unknown>;
  return (
    (data.marketing === undefined || typeof data.marketing === 'boolean') &&
    (data.analytics === undefined || typeof data.analytics === 'boolean') &&
    (data.saleOfData === undefined || typeof data.saleOfData === 'boolean')
  );
}

export function isConsentEvidenceJson(json: unknown): json is ConsentEvidenceJson {
  if (!json || typeof json !== 'object') return false;
  const data = json as Record<string, unknown>;
  return typeof data.strategy === 'string' && typeof data.hasReceipt === 'boolean';
}

export function isTrustMetadataJson(json: unknown): json is TrustMetadataJson {
  if (!json || typeof json !== 'object') return false;
  const data = json as Record<string, unknown>;
  return typeof data.trustLevel === 'string';
}

export function isRiskItemJson(json: unknown): json is RiskItemJson {
  if (!json || typeof json !== 'object') return false;
  const data = json as Record<string, unknown>;
  return (
    typeof data.id === 'string' &&
    typeof data.title === 'string' &&
    typeof data.severity === 'string' &&
    ['low', 'medium', 'high', 'critical'].includes(data.severity)
  );
}

export function isPlatformType(value: unknown): value is PlatformType {
  return typeof value === 'string' && ['meta', 'google', 'tiktok'].includes(value);
}

export function isTrustLevelType(value: unknown): value is TrustLevelType {
  return typeof value === 'string' && ['full', 'partial', 'weak', 'none', 'unknown'].includes(value);
}

export function isJobStatusType(value: unknown): value is JobStatusType {
  return typeof value === 'string' && ['pending', 'processing', 'success', 'failed', 'dead_letter'].includes(value);
}

export function isConsentStrategyType(value: unknown): value is ConsentStrategyType {
  return typeof value === 'string' && ['strict', 'balanced'].includes(value);
}

export function toCapiInputJson(json: unknown): CapiInputJson | null {
  return parseCapiInput(json);
}

export function toConsentStateJson(json: unknown): ConsentStateJson {
  return parseConsentState(json) ?? {};
}

export function toConsentEvidenceJson(json: unknown): ConsentEvidenceJson | null {
  return parseConsentEvidence(json);
}

export function toTrustMetadataJson(json: unknown): TrustMetadataJson | null {
  return parseTrustMetadata(json);
}

export function toPlatformResultsJson(json: unknown): PlatformResultsJson {
  return parsePlatformResults(json);
}

export function asString(value: unknown, fallback: string = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback: number = 0): number {
  return typeof value === 'number' && !isNaN(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback: boolean = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function asArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? value as T[] : fallback;
}

export interface ParserOptions<T> {

  fallback?: T;

  logErrors?: boolean;
}

export function createJsonParser<T>(
  mapper: (data: Record<string, unknown>) => T,
  validator?: (data: Record<string, unknown>) => boolean
): (json: unknown, options?: ParserOptions<T>) => T | null {
  return (json: unknown, options?: ParserOptions<T>): T | null => {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return options?.fallback ?? null;
    }

    const data = json as Record<string, unknown>;

    if (validator && !validator(data)) {
      return options?.fallback ?? null;
    }

    try {
      return mapper(data);
    } catch (error) {
      if (options?.logErrors) {
        console.error('JSON parsing error:', error);
      }
      return options?.fallback ?? null;
    }
  };
}

export function createJsonArrayParser<T>(
  itemParser: (item: unknown) => T | null
): (json: unknown) => T[] {
  return (json: unknown): T[] => {
    if (!Array.isArray(json)) {
      return [];
    }

    return json
      .map(itemParser)
      .filter((item): item is T => item !== null);
  };
}

export interface JsonParseError {
  type: 'INVALID_JSON' | 'MISSING_FIELD' | 'INVALID_TYPE' | 'VALIDATION_FAILED';
  message: string;
  field?: string;
}

export function parseCapiInputResult(json: unknown): Result<CapiInputJson, JsonParseError> {
  if (!json || typeof json !== 'object') {
    return err({ type: 'INVALID_JSON', message: 'Expected object' });
  }

  const data = json as Record<string, unknown>;

  if (typeof data.orderId !== 'string') {
    return err({ type: 'MISSING_FIELD', message: 'orderId is required', field: 'orderId' });
  }

  if (typeof data.value !== 'number') {
    return err({ type: 'MISSING_FIELD', message: 'value is required', field: 'value' });
  }

  return ok({
    orderId: data.orderId,
    value: data.value,
    currency: asString(data.currency, 'USD'),
    orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : null,
    items: Array.isArray(data.items)
      ? data.items.map(parseCapiLineItem).filter(Boolean) as CapiLineItem[]
      : undefined,
    contentIds: Array.isArray(data.contentIds)
      ? data.contentIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    numItems: asNumber(data.numItems) || undefined,
    tax: asNumber(data.tax) || undefined,
    shipping: asNumber(data.shipping) || undefined,
    processedAt: asString(data.processedAt) || undefined,
    webhookReceivedAt: asString(data.webhookReceivedAt) || undefined,
    checkoutToken: typeof data.checkoutToken === 'string' ? data.checkoutToken : null,
    shopifyOrderId: typeof data.shopifyOrderId === 'number' || typeof data.shopifyOrderId === 'string'
      ? data.shopifyOrderId
      : undefined,
  });
}

export function parseConsentStateResult(json: unknown): Result<ConsentStateJson, JsonParseError> {
  if (!json || typeof json !== 'object') {
    return err({ type: 'INVALID_JSON', message: 'Expected object' });
  }

  const data = json as Record<string, unknown>;

  if (data.marketing !== undefined && typeof data.marketing !== 'boolean') {
    return err({ type: 'INVALID_TYPE', message: 'marketing must be boolean', field: 'marketing' });
  }
  if (data.analytics !== undefined && typeof data.analytics !== 'boolean') {
    return err({ type: 'INVALID_TYPE', message: 'analytics must be boolean', field: 'analytics' });
  }
  if (data.saleOfData !== undefined && typeof data.saleOfData !== 'boolean') {
    return err({ type: 'INVALID_TYPE', message: 'saleOfData must be boolean', field: 'saleOfData' });
  }

  return ok({
    marketing: typeof data.marketing === 'boolean' ? data.marketing : undefined,
    analytics: typeof data.analytics === 'boolean' ? data.analytics : undefined,
    saleOfData: typeof data.saleOfData === 'boolean' ? data.saleOfData : undefined,
  });
}

export function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string, got ${typeof value}`);
  }
  return value;
}

export function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error(`${fieldName} must be a number, got ${typeof value}`);
  }
  return value;
}

export function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean, got ${typeof value}`);
  }
  return value;
}

export function requireArray<T>(value: unknown, fieldName: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array, got ${typeof value}`);
  }
  return value as T[];
}

export function requireObject<T extends object>(value: unknown, fieldName: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object, got ${typeof value}`);
  }
  return value as T;
}

