import type { KeyValidationResult, PixelEventPayload } from "../types";

export interface IngestContext {
  request: globalThis.Request;
  requestId: string;
  isProduction: boolean;
  allowFallback: boolean;
  origin: string | null;
  isNullOrigin: boolean;
  originHeaderPresent: boolean;
  signature: string | null;
  hasSignatureHeader: boolean;
  bodySignature: string | null;
  hasBodySignature: boolean;
  timestampHeader: string | null;
  bodySignatureTimestamp: number | null;
  timestamp: number | null;
  shopDomainHeader: string;
  bodySignatureShopDomain: string | null;
  signatureSource: "header" | "body" | "none";
  contentType: string | null;
  strictOrigin: boolean;
  allowUnsignedEvents: boolean;
  bodyText: string | null;
  bodyData: unknown | null;
  rawEvents: unknown[];
  batchTimestamp: number | undefined;
  validatedEvents: Array<{ payload: PixelEventPayload; index: number }>;
  shopDomain: string | null;
  environment: "test" | "live";
  shop: {
    id: string;
    shopDomain: string;
    isActive: boolean;
    ingestionSecret: string | null;
    pendingIngestionSecret: string | null;
    pendingSecretIssuedAt: Date | null;
    pendingSecretExpiry: Date | null;
    pendingSecretMatchCount: number;
    previousIngestionSecret: string | null;
    previousSecretExpiry: Date | null;
    primaryDomain: string | null;
    storefrontDomains: string[];
    pixelConfigs: Array<{
      clientConfig?: unknown;
      serverSideEnabled?: boolean | null;
    }>;
  } | null;
  shopAllowedDomains: string[];
  keyValidation: KeyValidationResult;
  mode: "purchase_only" | "full_funnel";
  enabledPixelConfigs: Array<{ serverSideEnabled?: boolean | null; clientSideEnabled?: boolean | null }>;
}

export type MiddlewareResult = 
  | { continue: true; context: IngestContext }
  | { continue: false; response: Response };

export type IngestMiddleware = (
  context: IngestContext
) => Promise<MiddlewareResult>;
