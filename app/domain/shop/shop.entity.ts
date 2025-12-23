/**
 * Shop Domain Entity
 *
 * Represents a shop in the domain layer, independent of database schema.
 * Contains business logic and validation rules for shops.
 */

import type { PlanId } from "../../services/billing/plans";

// =============================================================================
// Value Objects
// =============================================================================

/**
 * Shop tier - detected from Shopify plan
 */
export type ShopTier = "plus" | "non_plus" | "unknown";

/**
 * Consent strategy for CAPI sending
 */
export type ConsentStrategy = "strict" | "balanced" | "weak";

/**
 * Shop status based on subscription state
 */
export type ShopStatus = "active" | "inactive" | "uninstalled";

// =============================================================================
// Shop Entity
// =============================================================================

/**
 * Shop domain entity
 *
 * Represents a merchant shop with all its configuration and state.
 */
export interface Shop {
  readonly id: string;
  readonly shopDomain: string;
  readonly email: string | null;
  readonly name: string | null;
  
  // Subscription
  readonly plan: PlanId;
  readonly monthlyOrderLimit: number;
  readonly isActive: boolean;
  
  // Privacy settings
  readonly piiEnabled: boolean;
  readonly pcdAcknowledged: boolean;
  readonly pcdAcknowledgedAt: Date | null;
  readonly consentStrategy: ConsentStrategy;
  readonly dataRetentionDays: number;
  
  // Security
  readonly ingestionSecret: string | null;
  readonly previousIngestionSecret: string | null;
  readonly previousSecretExpiry: Date | null;
  
  // Domain configuration
  readonly primaryDomain: string | null;
  readonly storefrontDomains: string[];
  
  // Web Pixel
  readonly webPixelId: string | null;
  
  // Shop tier and checkout status
  readonly shopTier: ShopTier | null;
  readonly typOspPagesEnabled: boolean | null;
  readonly typOspLastCheckedAt: Date | null;
  readonly typOspDetectedAt: Date | null;
  readonly typOspStatusReason: string | null;
  
  // Timestamps
  readonly installedAt: Date;
  readonly uninstalledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Minimal shop data for common lookups
 */
export interface ShopBasic {
  readonly id: string;
  readonly shopDomain: string;
  readonly isActive: boolean;
  readonly plan: PlanId;
}

/**
 * Shop with billing information
 */
export interface ShopWithBilling extends ShopBasic {
  readonly monthlyOrderLimit: number;
  readonly consentStrategy: ConsentStrategy;
}

/**
 * Shop with consent settings
 */
export interface ShopWithConsent extends ShopBasic {
  readonly piiEnabled: boolean;
  readonly pcdAcknowledged: boolean;
  readonly consentStrategy: ConsentStrategy;
}

/**
 * Shop with security settings for verification
 */
export interface ShopWithSecurity extends ShopBasic {
  readonly ingestionSecret: string | null;
  readonly previousIngestionSecret: string | null;
  readonly previousSecretExpiry: Date | null;
  readonly primaryDomain: string | null;
  readonly storefrontDomains: string[];
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new shop entity
 */
export function createShop(params: {
  id: string;
  shopDomain: string;
  accessToken?: string | null;
  email?: string | null;
  name?: string | null;
  plan?: PlanId;
  ingestionSecret?: string | null;
  primaryDomain?: string | null;
  shopTier?: ShopTier | null;
}): Shop {
  const now = new Date();
  
  return {
    id: params.id,
    shopDomain: params.shopDomain,
    email: params.email ?? null,
    name: params.name ?? null,
    
    plan: params.plan ?? "free",
    monthlyOrderLimit: 100, // Free plan default
    isActive: true,
    
    piiEnabled: false,
    pcdAcknowledged: false,
    pcdAcknowledgedAt: null,
    consentStrategy: "strict",
    dataRetentionDays: 90,
    
    ingestionSecret: params.ingestionSecret ?? null,
    previousIngestionSecret: null,
    previousSecretExpiry: null,
    
    primaryDomain: params.primaryDomain ?? null,
    storefrontDomains: [],
    
    webPixelId: null,
    
    shopTier: params.shopTier ?? null,
    typOspPagesEnabled: null,
    typOspLastCheckedAt: null,
    typOspDetectedAt: null,
    typOspStatusReason: null,
    
    installedAt: now,
    uninstalledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

// =============================================================================
// Domain Logic
// =============================================================================

/**
 * Get the status of a shop
 */
export function getShopStatus(shop: Shop): ShopStatus {
  if (shop.uninstalledAt !== null) {
    return "uninstalled";
  }
  return shop.isActive ? "active" : "inactive";
}

/**
 * Check if shop has PII enabled and acknowledged
 */
export function isPiiFullyEnabled(shop: ShopWithConsent): boolean {
  return shop.piiEnabled && shop.pcdAcknowledged;
}

/**
 * Check if shop is within usage limits
 */
export function isWithinUsageLimits(shop: ShopWithBilling, currentUsage: number): boolean {
  return currentUsage < shop.monthlyOrderLimit;
}

/**
 * Get allowed storefront domains for a shop
 */
export function getAllowedDomains(shop: ShopWithSecurity): string[] {
  const domains = new Set<string>();
  
  // Always allow myshopify domain
  domains.add(shop.shopDomain);
  
  // Add primary domain if set
  if (shop.primaryDomain) {
    domains.add(shop.primaryDomain);
  }
  
  // Add custom storefront domains
  for (const domain of shop.storefrontDomains) {
    domains.add(domain);
  }
  
  return Array.from(domains);
}

/**
 * Check if a domain is allowed for a shop
 */
export function isDomainAllowed(shop: ShopWithSecurity, domain: string): boolean {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  const allowedDomains = getAllowedDomains(shop);
  
  return allowedDomains.some((allowed) => {
    const normalizedAllowed = allowed.toLowerCase().replace(/^www\./, "");
    return normalizedDomain === normalizedAllowed || normalizedDomain.endsWith(`.${normalizedAllowed}`);
  });
}

/**
 * Check if ingestion secret is in grace period
 */
export function isInSecretGracePeriod(shop: ShopWithSecurity): boolean {
  if (!shop.previousIngestionSecret || !shop.previousSecretExpiry) {
    return false;
  }
  return new Date() < shop.previousSecretExpiry;
}

/**
 * Get consent strategy with fallback
 */
export function getEffectiveConsentStrategy(shop: ShopWithConsent | Shop): ConsentStrategy {
  // Type guard to check if consentStrategy is valid
  const strategy = shop.consentStrategy;
  if (strategy === "strict" || strategy === "balanced" || strategy === "weak") {
    return strategy;
  }
  return "strict"; // Default to strict if invalid
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if value is a valid consent strategy
 */
export function isValidConsentStrategy(value: unknown): value is ConsentStrategy {
  return value === "strict" || value === "balanced" || value === "weak";
}

/**
 * Check if value is a valid shop tier
 */
export function isValidShopTier(value: unknown): value is ShopTier {
  return value === "plus" || value === "non_plus" || value === "unknown";
}

