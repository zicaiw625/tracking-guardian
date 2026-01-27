import type { CustomerPrivacyState, VisitorConsentCollectedEvent } from "./types";

export interface ConsentManager {
  marketingAllowed: boolean;
  analyticsAllowed: boolean;
  saleOfDataAllowed?: boolean;
  hasAnalyticsConsent(): boolean;
  hasMarketingConsent(): boolean;
  hasFullConsent(): boolean;
  updateFromStatus(status: CustomerPrivacyState | null | undefined, source: "init" | "event"): void;
}

export function createConsentManager(_logger?: (...args: unknown[]) => void): ConsentManager {
  let customerPrivacyStatus: CustomerPrivacyState | null = null;
  let marketingAllowed = false;
  let analyticsAllowed = false;
  let saleOfDataAllowed: boolean | undefined;
  function updateFromStatus(
    status: CustomerPrivacyState | null | undefined,
    _source: "init" | "event"
  ): void {
    if (!status || typeof status !== "object") {
      marketingAllowed = false;
      analyticsAllowed = false;
      saleOfDataAllowed = undefined;
      return;
    }
    customerPrivacyStatus = status;
    marketingAllowed = customerPrivacyStatus.marketingAllowed === true;
    analyticsAllowed = customerPrivacyStatus.analyticsProcessingAllowed === true;
    saleOfDataAllowed = "saleOfDataAllowed" in customerPrivacyStatus
      ? customerPrivacyStatus.saleOfDataAllowed === true
      : undefined;
  }
  function hasAnalyticsConsent(): boolean {
    return analyticsAllowed === true;
  }
  function hasMarketingConsent(): boolean {
    return marketingAllowed === true;
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
    } catch (err) {
      log("Could not subscribe to consent changes:", err);
    }
  }
}
