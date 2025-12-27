import { describe, it, expect } from "vitest";

interface CustomerPrivacyState {
  analyticsProcessingAllowed: boolean;
  marketingAllowed: boolean;
  preferencesProcessingAllowed: boolean;
  saleOfDataAllowed: boolean;
}

interface VisitorConsentCollectedEvent {
  customerPrivacy: CustomerPrivacyState;
}

function parseInitialConsent(initCustomerPrivacy: CustomerPrivacyState | undefined): {
  marketingAllowed: boolean;
  analyticsAllowed: boolean;
  saleOfDataAllowed: boolean;
} {

  if (!initCustomerPrivacy) {
    return {
      marketingAllowed: false,
      analyticsAllowed: false,
      saleOfDataAllowed: false,
    };
  }

  return {
    marketingAllowed: initCustomerPrivacy.marketingAllowed === true,
    analyticsAllowed: initCustomerPrivacy.analyticsProcessingAllowed === true,

    saleOfDataAllowed: initCustomerPrivacy.saleOfDataAllowed === true,
  };
}

function parseConsentEvent(event: VisitorConsentCollectedEvent): {
  marketingAllowed: boolean;
  analyticsAllowed: boolean;
  saleOfDataAllowed: boolean;
} {
  const updatedPrivacy = event.customerPrivacy;

  if (!updatedPrivacy) {
    throw new Error("Event missing customerPrivacy object");
  }

  return {
    marketingAllowed: updatedPrivacy.marketingAllowed === true,
    analyticsAllowed: updatedPrivacy.analyticsProcessingAllowed === true,

    saleOfDataAllowed: updatedPrivacy.saleOfDataAllowed === true,
  };
}

describe("P0-4: init.customerPrivacy structure", () => {
  it("should parse all consents granted", () => {
    const initPrivacy: CustomerPrivacyState = {
      analyticsProcessingAllowed: true,
      marketingAllowed: true,
      preferencesProcessingAllowed: true,
      saleOfDataAllowed: true,
    };

    const result = parseInitialConsent(initPrivacy);

    expect(result.marketingAllowed).toBe(true);
    expect(result.analyticsAllowed).toBe(true);
    expect(result.saleOfDataAllowed).toBe(true);
  });

  it("should parse all consents denied", () => {
    const initPrivacy: CustomerPrivacyState = {
      analyticsProcessingAllowed: false,
      marketingAllowed: false,
      preferencesProcessingAllowed: false,
      saleOfDataAllowed: false,
    };

    const result = parseInitialConsent(initPrivacy);

    expect(result.marketingAllowed).toBe(false);
    expect(result.analyticsAllowed).toBe(false);
    expect(result.saleOfDataAllowed).toBe(false);
  });

  it("should parse analytics only (common GDPR scenario)", () => {
    const initPrivacy: CustomerPrivacyState = {
      analyticsProcessingAllowed: true,
      marketingAllowed: false,
      preferencesProcessingAllowed: false,
      saleOfDataAllowed: false,
    };

    const result = parseInitialConsent(initPrivacy);

    expect(result.marketingAllowed).toBe(false);
    expect(result.analyticsAllowed).toBe(true);
    expect(result.saleOfDataAllowed).toBe(false);
  });

  it("should handle undefined init.customerPrivacy gracefully (P0-04: deny by default)", () => {
    const result = parseInitialConsent(undefined);

    expect(result.marketingAllowed).toBe(false);
    expect(result.analyticsAllowed).toBe(false);
    expect(result.saleOfDataAllowed).toBe(false);
  });
});

describe("P0-4: visitorConsentCollected event structure", () => {
  it("should parse consent from event.customerPrivacy (NOT event directly)", () => {
    const event: VisitorConsentCollectedEvent = {
      customerPrivacy: {
        analyticsProcessingAllowed: true,
        marketingAllowed: true,
        preferencesProcessingAllowed: true,
        saleOfDataAllowed: true,
      },
    };

    const result = parseConsentEvent(event);

    expect(result.marketingAllowed).toBe(true);
    expect(result.analyticsAllowed).toBe(true);
    expect(result.saleOfDataAllowed).toBe(true);
  });

  it("should parse consent update (user revokes marketing)", () => {
    const event: VisitorConsentCollectedEvent = {
      customerPrivacy: {
        analyticsProcessingAllowed: true,
        marketingAllowed: false,
        preferencesProcessingAllowed: false,
        saleOfDataAllowed: false,
      },
    };

    const result = parseConsentEvent(event);

    expect(result.marketingAllowed).toBe(false);
    expect(result.analyticsAllowed).toBe(true);
    expect(result.saleOfDataAllowed).toBe(false);
  });

  it("should NOT work with flat event structure (old buggy approach)", () => {
    const wrongEvent = {
      analyticsProcessingAllowed: true,
      marketingAllowed: true,
      saleOfDataAllowed: true,
    };

    expect(() => {
      parseConsentEvent(wrongEvent as unknown as VisitorConsentCollectedEvent);
    }).toThrow("Event missing customerPrivacy object");
  });
});

describe("P0-4: Edge cases and type coercion", () => {
  it("should treat non-boolean true as false (strict equality)", () => {
    const initPrivacy = {
      analyticsProcessingAllowed: "true" as unknown as boolean,
      marketingAllowed: 1 as unknown as boolean,
      preferencesProcessingAllowed: {} as unknown as boolean,
      saleOfDataAllowed: true,
    };

    const result = parseInitialConsent(initPrivacy as CustomerPrivacyState);

    expect(result.marketingAllowed).toBe(false);
    expect(result.analyticsAllowed).toBe(false);
    expect(result.saleOfDataAllowed).toBe(true);
  });

  it("should treat undefined saleOfDataAllowed as denied (P0-04: deny by default)", () => {
    const initPrivacy = {
      analyticsProcessingAllowed: true,
      marketingAllowed: true,
      preferencesProcessingAllowed: true,
    } as CustomerPrivacyState;

    const result = parseInitialConsent(initPrivacy);

    expect(result.saleOfDataAllowed).toBe(false);
  });
});
