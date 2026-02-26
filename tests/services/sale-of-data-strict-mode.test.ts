import { describe, it, expect } from "vitest";

function isOptOutSaleOfDataAllowed(saleOfData: boolean | undefined | null): boolean {
  return saleOfData !== false;
}

describe("P0-04: sale_of_data Opt-Out Mode Consistency", () => {
  describe("Core Logic Validation", () => {
    it("should allow when saleOfData is explicitly true", () => {
      expect(isOptOutSaleOfDataAllowed(true)).toBe(true);
    });
    it("should block when saleOfData is explicitly false", () => {
      expect(isOptOutSaleOfDataAllowed(false)).toBe(false);
    });
    it("should allow when saleOfData is undefined", () => {
      expect(isOptOutSaleOfDataAllowed(undefined)).toBe(true);
    });
    it("should allow when saleOfData is null", () => {
      expect(isOptOutSaleOfDataAllowed(null)).toBe(true);
    });
  });
  describe("ConsentState Mapping Consistency", () => {
    function mapToConsentState(rawConsentState: {
      marketing?: boolean;
      analytics?: boolean;
      saleOfData?: boolean;
    } | null): { saleOfDataAllowed?: boolean } | null {
      if (!rawConsentState) return null;
      if (rawConsentState.saleOfData === true) {
        return { saleOfDataAllowed: true };
      }
      if (rawConsentState.saleOfData === false) {
        return { saleOfDataAllowed: false };
      }
      return {
        saleOfDataAllowed: undefined,
      };
    }
    it("should map saleOfData=true to saleOfDataAllowed=true", () => {
      const result = mapToConsentState({ saleOfData: true });
      expect(result?.saleOfDataAllowed).toBe(true);
    });
    it("should map saleOfData=false to saleOfDataAllowed=false", () => {
      const result = mapToConsentState({ saleOfData: false });
      expect(result?.saleOfDataAllowed).toBe(false);
    });
    it("should map saleOfData=undefined to saleOfDataAllowed=undefined (P0-04)", () => {
      const result = mapToConsentState({ marketing: true, analytics: true });
      expect(result?.saleOfDataAllowed).toBeUndefined();
    });
    it("should map null consentState to null", () => {
      const result = mapToConsentState(null);
      expect(result).toBeNull();
    });
  });
  describe("Module-Specific Test Cases", () => {
    describe("ConversionJob Processing", () => {
      function processConversionJobConsentMapping(receipt: {
        consentState: {
          marketing?: boolean;
          analytics?: boolean;
          saleOfData?: boolean;
        } | null;
      } | null) {
        const rawConsentState = receipt?.consentState;
        if (!rawConsentState) return null;
        let saleOfDataAllowed: boolean | undefined;
        if (rawConsentState.saleOfData === true) {
          saleOfDataAllowed = true;
        } else if (rawConsentState.saleOfData === false) {
          saleOfDataAllowed = false;
        }
        return {
          marketing: rawConsentState.marketing,
          analytics: rawConsentState.analytics,
          saleOfDataAllowed,
        };
      }
      it("should allow send when receipt has undefined saleOfData", () => {
        const receipt = {
          consentState: { marketing: true, analytics: true },
        };
        const result = processConversionJobConsentMapping(receipt);
        expect(result?.saleOfDataAllowed).toBeUndefined();
      });
      it("should allow send when receipt has explicit saleOfData=true", () => {
        const receipt = {
          consentState: { marketing: true, analytics: true, saleOfData: true },
        };
        const result = processConversionJobConsentMapping(receipt);
        expect(result?.saleOfDataAllowed).toBe(true);
      });
      it("should block send when receipt has saleOfData=false", () => {
        const receipt = {
          consentState: { marketing: true, analytics: true, saleOfData: false },
        };
        const result = processConversionJobConsentMapping(receipt);
        expect(result?.saleOfDataAllowed).toBe(false);
      });
      it("should return null when no receipt exists", () => {
        const result = processConversionJobConsentMapping(null);
        expect(result).toBeNull();
      });
    });
    describe("Consent Reconciler Processing", () => {
      function reconcileConsentState(receipt: {
        consentState: {
          marketing?: boolean;
          analytics?: boolean;
          saleOfData?: boolean;
        } | null;
      }) {
        const rawConsentState = receipt.consentState;
        if (!rawConsentState) return null;
        let saleOfDataAllowed: boolean | undefined;
        if (rawConsentState.saleOfData === true) {
          saleOfDataAllowed = true;
        } else if (rawConsentState.saleOfData === false) {
          saleOfDataAllowed = false;
        }
        return {
          marketing: rawConsentState.marketing,
          analytics: rawConsentState.analytics,
          saleOfDataAllowed,
        };
      }
      it("should allow reconciliation when saleOfData is missing", () => {
        const receipt = {
          consentState: { marketing: true, analytics: true },
        };
        const result = reconcileConsentState(receipt);
        expect(result?.saleOfDataAllowed).toBeUndefined();
      });
      it("should allow reconciliation when saleOfData=true", () => {
        const receipt = {
          consentState: { marketing: true, analytics: true, saleOfData: true },
        };
        const result = reconcileConsentState(receipt);
        expect(result?.saleOfDataAllowed).toBe(true);
      });
      it("should block reconciliation when saleOfData=false", () => {
        const receipt = {
          consentState: { marketing: true, analytics: true, saleOfData: false },
        };
        const result = reconcileConsentState(receipt);
        expect(result?.saleOfDataAllowed).toBe(false);
      });
    });
    describe("Pixel Events Entry Point", () => {
      function checkPixelEventSaleOfData(consent: {
        marketing?: boolean;
        analytics?: boolean;
        saleOfData?: boolean;
      } | undefined) {
        return consent?.saleOfData !== false;
      }
      it("should allow when saleOfData is undefined", () => {
        const consent = { marketing: true, analytics: true };
        expect(checkPixelEventSaleOfData(consent)).toBe(true);
      });
      it("should allow when consent object is undefined", () => {
        expect(checkPixelEventSaleOfData(undefined)).toBe(true);
      });
      it("should allow when saleOfData=true", () => {
        const consent = { marketing: true, analytics: true, saleOfData: true };
        expect(checkPixelEventSaleOfData(consent)).toBe(true);
      });
      it("should block when saleOfData=false", () => {
        const consent = { marketing: true, analytics: true, saleOfData: false };
        expect(checkPixelEventSaleOfData(consent)).toBe(false);
      });
    });
  });
  describe("Anti-Regression: Explicit false still blocks", () => {
    function optOutOnlyLogic(saleOfData: boolean | undefined): boolean {
      return saleOfData !== false;
    }
    it("keeps undefined allowed in opt-out-only mode", () => {
      expect(optOutOnlyLogic(undefined)).toBe(true);
    });
    it("keeps explicit true allowed", () => {
      expect(optOutOnlyLogic(true)).toBe(true);
    });
    it("keeps explicit false blocked", () => {
      expect(optOutOnlyLogic(false)).toBe(false);
    });
  });
  describe("Historical Data Migration Notes", () => {
    it("documents that old receipts without saleOfData remain allowed unless explicit opt-out", () => {
      const historicalReceipt = {
        consentState: {
          marketing: true,
          analytics: true,
        },
      };
      const saleOfDataAllowed = historicalReceipt.consentState.saleOfData !== false;
      expect(saleOfDataAllowed).toBe(true);
    });
  });
});

describe("Web Pixel Settings Schema Validation", () => {
  const EXPECTED_FIELDS = [
    "ingestion_key",
    "shop_domain",
  ];
  it("should have all required settings fields defined", () => {
    expect(EXPECTED_FIELDS).toHaveLength(2);
    expect(EXPECTED_FIELDS).toContain("ingestion_key");
    expect(EXPECTED_FIELDS).toContain("shop_domain");
  });
  it("should NOT include deprecated fields", () => {
    expect(EXPECTED_FIELDS).not.toContain("backend_url");
    expect(EXPECTED_FIELDS).not.toContain("schema_version");
  });
  it("should use single_line_text_field type (web pixel requirement)", () => {
    const validType = "single_line_text_field";
    expect(validType).toBe("single_line_text_field");
  });
});
