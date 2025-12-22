/**
 * Consent Management Module
 * 
 * Handles customer privacy consent state tracking and updates.
 */

import type { CustomerPrivacyState, VisitorConsentCollectedEvent } from "./types";

export interface ConsentManager {
  /** Whether marketing tracking is allowed */
  marketingAllowed: boolean;
  /** Whether analytics tracking is allowed */
  analyticsAllowed: boolean;
  /** Whether sale of data is allowed (CCPA) */
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
 * @param logger - Optional logging function
 * @returns ConsentManager instance
 */
export function createConsentManager(logger?: (...args: unknown[]) => void): ConsentManager {
  const log = logger || (() => {});
  
  let customerPrivacyStatus: CustomerPrivacyState | null = null;
  let marketingAllowed = false;
  let analyticsAllowed = false;
  let saleOfDataAllowed = true;

  function updateFromStatus(
    status: CustomerPrivacyState | null | undefined,
    source: "init" | "event"
  ): void {
    if (!status || typeof status !== "object") {
      log(`${source} customerPrivacy not available, consent state unknown`);
      return;
    }

    customerPrivacyStatus = status;
    marketingAllowed = customerPrivacyStatus.marketingAllowed === true;
    analyticsAllowed = customerPrivacyStatus.analyticsProcessingAllowed === true;
    saleOfDataAllowed = customerPrivacyStatus.saleOfDataAllowed !== false;

    log(`Consent state updated from ${source}.customerPrivacy:`, {
      marketingAllowed,
      analyticsAllowed,
      saleOfDataAllowed,
    });
  }

  function hasAnalyticsConsent(): boolean {
    return analyticsAllowed === true;
  }

  function hasMarketingConsent(): boolean {
    return marketingAllowed === true && saleOfDataAllowed;
  }

  function hasFullConsent(): boolean {
    return analyticsAllowed === true && marketingAllowed === true && saleOfDataAllowed;
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

