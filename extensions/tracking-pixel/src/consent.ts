/**
 * Consent Management Module
 * 
 * P0-04: Handles customer privacy consent state tracking and updates.
 * 
 * SECURITY: All consent values default to FALSE (deny by default).
 * Consent is only granted when EXPLICITLY set to true.
 * Unknown/undefined values are treated as NOT consented.
 */

import type { CustomerPrivacyState, VisitorConsentCollectedEvent } from "./types";

export interface ConsentManager {
  /** Whether marketing tracking is allowed */
  marketingAllowed: boolean;
  /** Whether analytics tracking is allowed */
  analyticsAllowed: boolean;
  /** Whether sale of data is allowed (CCPA) - P0-04: defaults to FALSE */
  saleOfDataAllowed: boolean;
  /** Check if analytics consent is granted */
  hasAnalyticsConsent(): boolean;
  /** Check if marketing consent is granted (includes sale of data check) */
  hasMarketingConsent(): boolean;
  /** Check if full consent (both analytics and marketing) is granted */
  hasFullConsent(): boolean;
  /** Update consent state from privacy status */
  updateFromStatus(status: CustomerPrivacyState | null | undefined, source: "init" | "event"): void;
}

/**
 * Create a consent manager instance.
 * 
 * P0-04: All consent values default to FALSE (deny by default).
 * This is the most privacy-protective default.
 * 
 * @param logger - Optional logging function
 * @returns ConsentManager instance
 */
export function createConsentManager(logger?: (...args: unknown[]) => void): ConsentManager {
  const log = logger || (() => {});
  
  let customerPrivacyStatus: CustomerPrivacyState | null = null;
  
  // P0-04: All defaults are FALSE (deny by default)
  let marketingAllowed = false;
  let analyticsAllowed = false;
  let saleOfDataAllowed = false; // P0-04: Changed from true to false

  function updateFromStatus(
    status: CustomerPrivacyState | null | undefined,
    source: "init" | "event"
  ): void {
    if (!status || typeof status !== "object") {
      log(`${source} customerPrivacy not available, consent state remains denied (P0-04)`);
      // P0-04: Do NOT reset to permissive defaults when status is unavailable
      return;
    }

    customerPrivacyStatus = status;
    
    // P0-04: Strict boolean checks - only true === true grants consent
    marketingAllowed = customerPrivacyStatus.marketingAllowed === true;
    analyticsAllowed = customerPrivacyStatus.analyticsProcessingAllowed === true;
    
    // P0-04: saleOfDataAllowed must be EXPLICITLY true, not just "not false"
    // This means undefined/null/missing field = NOT allowed
    saleOfDataAllowed = customerPrivacyStatus.saleOfDataAllowed === true;

    log(`Consent state updated from ${source}.customerPrivacy (P0-04 strict):`, {
      marketingAllowed,
      analyticsAllowed,
      saleOfDataAllowed,
      rawValues: {
        marketingAllowed: customerPrivacyStatus.marketingAllowed,
        analyticsProcessingAllowed: customerPrivacyStatus.analyticsProcessingAllowed,
        saleOfDataAllowed: customerPrivacyStatus.saleOfDataAllowed,
      },
    });
  }

  function hasAnalyticsConsent(): boolean {
    return analyticsAllowed === true;
  }

  function hasMarketingConsent(): boolean {
    // P0-04: Both must be explicitly true
    return marketingAllowed === true && saleOfDataAllowed === true;
  }

  function hasFullConsent(): boolean {
    return analyticsAllowed === true && marketingAllowed === true && saleOfDataAllowed === true;
  }

  return {
    get marketingAllowed() { return marketingAllowed; },
    get analyticsAllowed() { return analyticsAllowed; },
    get saleOfDataAllowed() { return saleOfDataAllowed; },
    hasAnalyticsConsent,
    hasMarketingConsent,
    hasFullConsent,
    updateFromStatus,
  };
}

/**
 * Subscribe to consent changes if available.
 * 
 * @param customerPrivacy - Shopify customer privacy object
 * @param consentManager - Consent manager instance
 * @param logger - Optional logging function
 */
export function subscribeToConsentChanges(
  customerPrivacy: { subscribe?: (event: string, handler: (e: VisitorConsentCollectedEvent) => void) => void },
  consentManager: ConsentManager,
  logger?: (...args: unknown[]) => void
): void {
  const log = logger || (() => {});

  if (customerPrivacy && typeof customerPrivacy.subscribe === "function") {
    try {
      customerPrivacy.subscribe("visitorConsentCollected", (event: VisitorConsentCollectedEvent) => {
        consentManager.updateFromStatus(event.customerPrivacy, "event");
      });
      log("Subscribed to visitorConsentCollected");
    } catch (err) {
      log("Could not subscribe to consent changes:", err);
    }
  } else {
    log("customerPrivacy.subscribe not available, using initial state only");
  }
}

