

import type { CustomerPrivacyState, VisitorConsentCollectedEvent } from "./types";

export interface ConsentManager {

  marketingAllowed: boolean;

  analyticsAllowed: boolean;

  saleOfDataAllowed: boolean;

  hasAnalyticsConsent(): boolean;

  hasMarketingConsent(): boolean;

  hasFullConsent(): boolean;

  updateFromStatus(status: CustomerPrivacyState | null | undefined, source: "init" | "event"): void;
}

export function createConsentManager(logger?: (...args: unknown[]) => void): ConsentManager {
  const log = logger || (() => {});

  let customerPrivacyStatus: CustomerPrivacyState | null = null;

  let marketingAllowed = false;
  let analyticsAllowed = false;
  let saleOfDataAllowed = false;

  function updateFromStatus(
    status: CustomerPrivacyState | null | undefined,
    source: "init" | "event"
  ): void {
    if (!status || typeof status !== "object") {
      log(`${source} customerPrivacy not available, consent state remains denied (P0-04)`);

      return;
    }

    customerPrivacyStatus = status;

    marketingAllowed = customerPrivacyStatus.marketingAllowed === true;
    analyticsAllowed = customerPrivacyStatus.analyticsProcessingAllowed === true;

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

