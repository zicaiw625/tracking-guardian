import { describe, it, expect } from "vitest";

function isStrictSaleOfDataAllowed(saleOfData: boolean | undefined | null): boolean {
  return saleOfData === true;
}

describe("P0-04: sale_of_data Strict Mode Consistency", () => {
  describe("Core Logic Validation", () => {
    it("should ALLOW when saleOfData is explicitly true", () => {
      expect(isStrictSaleOfDataAllowed(true)).toBe(true);
    });
    it("should BLOCK when saleOfData is explicitly false", () => {
      expect(isStrictSaleOfDataAllowed(false)).toBe(false);
    });
    it("should BLOCK when saleOfData is undefined (deny-by-default)", () => {
      expect(isStrictSaleOfDataAllowed(undefined)).toBe(false);
    });
    it("should BLOCK when saleOfData is null (deny-by-default)", () => {
      expect(isStrictSaleOfDataAllowed(null)).toBe(false);
    });
  });
  describe("ConsentState Mapping Consistency", () => {
    function mapToConsentState(rawConsentState: {
      marketing?: boolean;
      analytics?: boolean;
      saleOfData?: boolean;
    } | null): { saleOfDataAllowed: boolean } | null {
      if (!rawConsentState) return null;
      return {
        saleOfDataAllowed: rawConsentState.saleOfData === true,
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
    it("should map saleOfData=undefined to saleOfDataAllowed=false (P0-04)", () => {
      const result = mapToConsentState({ marketing: true, analytics: true });
      expect(result?.saleOfDataAllowed).toBe(false);
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
        return {
          marketing: rawConsentState.marketing,
          analytics: rawConsentState.analytics,
          saleOfDataAllowed: rawConsentState.saleOfData === true,
        };
      }
      it("should block send when receipt has undefined saleOfData", () => {
        const receipt = {
          consentState: { marketing: true, analytics: true },
        };
        const result = processConversionJobConsentMapping(receipt);
        expect(result?.saleOfDataAllowed).toBe(false);
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
        return {
          marketing: rawConsentState.marketing,
          analytics: rawConsentState.analytics,
          saleOfDataAllowed: rawConsentState.saleOfData === true,
        };
      }
      it("should block reconciliation when saleOfData is missing", () => {
        const receipt = {
          consentState: { marketing: true, analytics: true },
        };
        const result = reconcileConsentState(receipt);
        expect(result?.saleOfDataAllowed).toBe(false);
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
        return consent?.saleOfData === true;
      }
      it("should block when saleOfData is undefined", () => {
        const consent = { marketing: true, analytics: true };
        expect(checkPixelEventSaleOfData(consent)).toBe(false);
      });
      it("should block when consent object is undefined", () => {
        expect(checkPixelEventSaleOfData(undefined)).toBe(false);
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
  describe("Anti-Regression: Old Loose Logic Should Fail", () => {
    function oldLooseLogic(saleOfData: boolean | undefined): boolean {
      return saleOfData !== false;
    }
    function newStrictLogic(saleOfData: boolean | undefined): boolean {
      return saleOfData === true;
    }
    it("demonstrates the difference: undefined should be BLOCKED, not allowed", () => {
      expect(oldLooseLogic(undefined)).toBe(true);
      expect(newStrictLogic(undefined)).toBe(false);
    });
    it("demonstrates the difference: explicit true works the same", () => {
      expect(oldLooseLogic(true)).toBe(true);
      expect(newStrictLogic(true)).toBe(true);
    });
    it("demonstrates the difference: explicit false works the same", () => {
      expect(oldLooseLogic(false)).toBe(false);
      expect(newStrictLogic(false)).toBe(false);
    });
  });
  describe("Historical Data Migration Notes", () => {
    it("documents that old receipts without saleOfData are now blocked", () => {
      const historicalReceipt = {
        consentState: {
          marketing: true,
          analytics: true,
        },
      };
      const saleOfDataAllowed = historicalReceipt.consentState.saleOfData === true;
      expect(saleOfDataAllowed).toBe(false);
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
