/**
 * Consent-Related Type Definitions
 * 
 * Types for privacy consent, GDPR compliance, and consent-based filtering.
 */

// =============================================================================
// Consent Categories
// =============================================================================

/**
 * Consent category for platform classification.
 */
export type ConsentCategory = "marketing" | "analytics";

/**
 * Consent strategy for shops.
 * - strict: Require explicit consent for all tracking
 * - balanced: Allow analytics with implicit consent, require marketing consent
 * - weak: Allow all tracking unless explicitly denied (deprecated)
 */
export type ConsentStrategy = "strict" | "balanced" | "weak";

// =============================================================================
// Consent State
// =============================================================================

/**
 * Current consent state from customer privacy API.
 */
export interface ConsentState {
  marketing?: boolean;
  analytics?: boolean;
  saleOfDataAllowed?: boolean;
}

/**
 * Decision result from consent evaluation.
 */
export interface ConsentDecision {
  allowed: boolean;
  reason?: string;
  usedConsent?: "marketing" | "analytics" | "both" | "none" | "weak";
}

// =============================================================================
// Platform Consent Configuration
// =============================================================================

/**
 * Platform-specific consent requirements.
 */
export interface PlatformConsentConfig {
  /** Primary consent category for this platform */
  category: ConsentCategory;
  /** Whether platform can be treated as marketing in certain contexts */
  dualUse: boolean;
  /** Whether platform requires sale_of_data consent */
  requiresSaleOfData: boolean;
}

// =============================================================================
// GDPR Types
// =============================================================================

/**
 * GDPR job types from Shopify webhooks.
 */
export type GDPRJobType = "data_request" | "customer_redact" | "shop_redact";

/**
 * GDPR job status.
 */
export type GDPRJobStatus = "pending" | "processing" | "completed" | "failed";

/**
 * GDPR job data structure.
 */
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

// =============================================================================
// Trust Verification
// =============================================================================

/**
 * Trust level for pixel event receipts.
 */
export type TrustLevel = "trusted" | "partial" | "untrusted";

/**
 * Trust verification result.
 */
export interface TrustResult {
  level: TrustLevel;
  trusted: boolean;
  reason?: string;
}

/**
 * Trust verification options.
 */
export interface TrustVerificationOptions {
  strictOriginValidation: boolean;
  allowNullOrigin: boolean;
  maxReceiptAgeMs: number;
  maxTimeSkewMs: number;
}

