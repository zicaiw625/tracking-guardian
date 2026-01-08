export type ConsentCategory = "marketing" | "analytics";

export type ConsentStrategy = "strict" | "balanced" | "weak";

export interface ConsentState {
  marketing?: boolean;
  analytics?: boolean;
  saleOfDataAllowed?: boolean;
}

export interface ConsentDecision {
  allowed: boolean;
  reason?: string;
  usedConsent?: "marketing" | "analytics" | "both" | "none" | "weak";
}

export interface PlatformConsentConfig {

  category: ConsentCategory;

  dualUse: boolean;

  requiresSaleOfData: boolean;
}

export type GDPRJobType = "data_request" | "customer_redact" | "shop_redact";

export type GDPRJobStatus = "pending" | "processing" | "completed" | "failed";

export interface GDPRJobData {
  id: string;
  shopId: string;
  jobType: GDPRJobType;
  status: GDPRJobStatus;
  customerId?: string | null;
  customerEmail?: string | null;
  ordersToRedact?: string[];
  errorMessage?: string | null;
  createdAt: Date;
  completedAt?: Date | null;
}

export type TrustLevel = "trusted" | "partial" | "untrusted";

export interface TrustResult {
  level: TrustLevel;
  trusted: boolean;
  reason?: string;
}

export interface TrustVerificationOptions {
  strictOriginValidation: boolean;
  allowNullOrigin: boolean;
  maxReceiptAgeMs: number;
  maxTimeSkewMs: number;
}
