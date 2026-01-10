import type { PlanId } from "../../services/billing/plans";

export type ShopTier = "plus" | "non_plus" | "unknown";

export type ConsentStrategy = "strict" | "balanced" | "weak";

export type ShopStatus = "active" | "inactive" | "uninstalled";

export interface Shop {
  readonly id: string;
  readonly shopDomain: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly plan: PlanId;
  readonly monthlyOrderLimit: number;
  readonly isActive: boolean;
  readonly consentStrategy: ConsentStrategy;
  readonly dataRetentionDays: number;
  readonly ingestionSecret: string | null;
  readonly previousIngestionSecret: string | null;
  readonly previousSecretExpiry: Date | null;
  readonly primaryDomain: string | null;
  readonly storefrontDomains: string[];
  readonly webPixelId: string | null;
  readonly shopTier: ShopTier | null;
  readonly typOspPagesEnabled: boolean | null;
  readonly typOspLastCheckedAt: Date | null;
  readonly typOspDetectedAt: Date | null;
  readonly typOspStatusReason: string | null;
  readonly installedAt: Date;
  readonly uninstalledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ShopBasic {
  readonly id: string;
  readonly shopDomain: string;
  readonly isActive: boolean;
  readonly plan: PlanId;
}

export interface ShopWithBilling extends ShopBasic {
  readonly monthlyOrderLimit: number;
  readonly consentStrategy: ConsentStrategy;
}

export interface ShopWithConsent extends ShopBasic {
  readonly consentStrategy: ConsentStrategy;
}

export interface ShopWithSecurity extends ShopBasic {
  readonly ingestionSecret: string | null;
  readonly previousIngestionSecret: string | null;
  readonly previousSecretExpiry: Date | null;
  readonly primaryDomain: string | null;
  readonly storefrontDomains: string[];
}

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
    monthlyOrderLimit: 100,
    isActive: true,
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

export function getShopStatus(shop: Shop): ShopStatus {
  if (shop.uninstalledAt !== null) {
    return "uninstalled";
  }
  return shop.isActive ? "active" : "inactive";
}

export function isWithinUsageLimits(shop: ShopWithBilling, currentUsage: number): boolean {
  return currentUsage < shop.monthlyOrderLimit;
}

export function getAllowedDomains(shop: ShopWithSecurity): string[] {
  const domains = new Set<string>();
  domains.add(shop.shopDomain);
  if (shop.primaryDomain) {
    domains.add(shop.primaryDomain);
  }
  for (const domain of shop.storefrontDomains) {
    domains.add(domain);
  }
  return Array.from(domains);
}

export function isDomainAllowed(shop: ShopWithSecurity, domain: string): boolean {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  const allowedDomains = getAllowedDomains(shop);
  return allowedDomains.some((allowed) => {
    const normalizedAllowed = allowed.toLowerCase().replace(/^www\./, "");
    return normalizedDomain === normalizedAllowed || normalizedDomain.endsWith(`.${normalizedAllowed}`);
  });
}

export function isInSecretGracePeriod(shop: ShopWithSecurity): boolean {
  if (!shop.previousIngestionSecret || !shop.previousSecretExpiry) {
    return false;
  }
  return new Date() < shop.previousSecretExpiry;
}

export function getEffectiveConsentStrategy(shop: ShopWithConsent | Shop): ConsentStrategy {
  const strategy = shop.consentStrategy;
  if (strategy === "strict" || strategy === "balanced" || strategy === "weak") {
    return strategy;
  }
  return "strict";
}

export function isValidConsentStrategy(value: unknown): value is ConsentStrategy {
  return value === "strict" || value === "balanced" || value === "weak";
}

export function isValidShopTier(value: unknown): value is ShopTier {
  return value === "plus" || value === "non_plus" || value === "unknown";
}
