import { describe, it, expect } from "vitest";
import type { TypOspStatus, TypOspUnknownReason } from "../../app/services/checkout-profile.server";

interface CheckoutProfileNode {
  id: string;
  name: string;
  isPublished: boolean;
  typOspPagesActive?: boolean;
}

interface CheckoutProfilesResponse {
  data?: {
    checkoutProfiles?: {
      nodes: CheckoutProfileNode[];
    };
    shop?: {
      checkoutApiSupported?: boolean;
      plan?: {
        shopifyPlus?: boolean;
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

function parseCheckoutProfilesResponse(response: CheckoutProfilesResponse): {
  status: TypOspStatus;
  typOspPagesEnabled: boolean | null;
  unknownReason?: TypOspUnknownReason;
  confidence: "high" | "medium" | "low";
} {
  if (response.errors) {
    const errorMessages = response.errors.map(e => e.message || "").join(" ");
    
    if (errorMessages.includes("access") || errorMessages.includes("permission")) {
      return {
        status: "unknown",
        typOspPagesEnabled: null,
        unknownReason: "NO_EDITOR_ACCESS",
        confidence: "low",
      };
    }
    
    return {
      status: "unknown",
      typOspPagesEnabled: null,
      unknownReason: "API_ERROR",
      confidence: "low",
    };
  }

  const profiles = response.data?.checkoutProfiles?.nodes || [];
  const shop = response.data?.shop;
  const isPlus = shop?.plan?.shopifyPlus === true;

  if (profiles.length === 0) {
    if (!isPlus) {
      return {
        status: "unknown",
        typOspPagesEnabled: null,
        unknownReason: "NOT_PLUS",
        confidence: "medium",
      };
    }
    return {
      status: "unknown",
      typOspPagesEnabled: null,
      unknownReason: "NO_PROFILES",
      confidence: "low",
    };
  }

  const hasTypOspField = profiles.some(node => node.typOspPagesActive !== undefined);
  
  if (!hasTypOspField) {
    const checkoutApiSupported = shop?.checkoutApiSupported === true;
    return {
      status: checkoutApiSupported ? "enabled" : "disabled",
      typOspPagesEnabled: checkoutApiSupported,
      unknownReason: "FIELD_NOT_AVAILABLE",
      confidence: "medium",
    };
  }

  const publishedProfiles = profiles.filter(p => p.isPublished);
  const hasTypOspActive = publishedProfiles.some(p => p.typOspPagesActive === true);

  return {
    status: hasTypOspActive ? "enabled" : "disabled",
    typOspPagesEnabled: hasTypOspActive,
    confidence: "high",
  };
}

describe("P0-2: checkoutProfiles with typOspPagesActive", () => {
  it("should detect enabled TYP/OSP from typOspPagesActive=true", () => {
    const response: CheckoutProfilesResponse = {
      data: {
        checkoutProfiles: {
          nodes: [
            {
              id: "gid://shopify/CheckoutProfile/1",
              name: "Default",
              isPublished: true,
              typOspPagesActive: true,
            },
          ],
        },
        shop: {
          checkoutApiSupported: true,
          plan: { shopifyPlus: true },
        },
      },
    };

    const result = parseCheckoutProfilesResponse(response);

    expect(result.status).toBe("enabled");
    expect(result.typOspPagesEnabled).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.unknownReason).toBeUndefined();
  });

  it("should detect disabled TYP/OSP from typOspPagesActive=false", () => {
    const response: CheckoutProfilesResponse = {
      data: {
        checkoutProfiles: {
          nodes: [
            {
              id: "gid://shopify/CheckoutProfile/1",
              name: "Default",
              isPublished: true,
              typOspPagesActive: false,
            },
          ],
        },
        shop: {
          checkoutApiSupported: true,
          plan: { shopifyPlus: true },
        },
      },
    };

    const result = parseCheckoutProfilesResponse(response);

    expect(result.status).toBe("disabled");
    expect(result.typOspPagesEnabled).toBe(false);
    expect(result.confidence).toBe("high");
  });

  it("should handle multiple profiles (only check published)", () => {
    const response: CheckoutProfilesResponse = {
      data: {
        checkoutProfiles: {
          nodes: [
            {
              id: "gid://shopify/CheckoutProfile/1",
              name: "Default",
              isPublished: true,
              typOspPagesActive: false,
            },
            {
              id: "gid://shopify/CheckoutProfile/2",
              name: "Draft",
              isPublished: false,
              typOspPagesActive: true,
            },
          ],
        },
        shop: {
          checkoutApiSupported: true,
          plan: { shopifyPlus: true },
        },
      },
    };

    const result = parseCheckoutProfilesResponse(response);

    expect(result.status).toBe("disabled");
    expect(result.typOspPagesEnabled).toBe(false);
  });
});

describe("P0-7: checkoutProfiles error handling", () => {
  it("should return unknown with NO_EDITOR_ACCESS for permission errors", () => {
    const response: CheckoutProfilesResponse = {
      errors: [
        { message: "Access denied. Requires access to checkout and accounts editor." },
      ],
    };

    const result = parseCheckoutProfilesResponse(response);

    expect(result.status).toBe("unknown");
    expect(result.typOspPagesEnabled).toBeNull();
    expect(result.unknownReason).toBe("NO_EDITOR_ACCESS");
    expect(result.confidence).toBe("low");
  });

  it("should return unknown with NOT_PLUS for non-Plus shops", () => {
    const response: CheckoutProfilesResponse = {
      data: {
        checkoutProfiles: {
          nodes: [],
        },
        shop: {
          checkoutApiSupported: false,
          plan: { shopifyPlus: false },
        },
      },
    };

    const result = parseCheckoutProfilesResponse(response);

    expect(result.status).toBe("unknown");
    expect(result.unknownReason).toBe("NOT_PLUS");
    expect(result.confidence).toBe("medium");
  });

  it("should return unknown with API_ERROR for other errors", () => {
    const response: CheckoutProfilesResponse = {
      errors: [
        { message: "Internal server error" },
      ],
    };

    const result = parseCheckoutProfilesResponse(response);

    expect(result.status).toBe("unknown");
    expect(result.unknownReason).toBe("API_ERROR");
  });
});

describe("P0-2: Fallback to checkoutApiSupported", () => {
  it("should fallback when typOspPagesActive field not in response", () => {
    const response: CheckoutProfilesResponse = {
      data: {
        checkoutProfiles: {
          nodes: [
            {
              id: "gid://shopify/CheckoutProfile/1",
              name: "Default",
              isPublished: true,
            },
          ],
        },
        shop: {
          checkoutApiSupported: true,
          plan: { shopifyPlus: true },
        },
      },
    };

    const result = parseCheckoutProfilesResponse(response);

    expect(result.status).toBe("enabled");
    expect(result.typOspPagesEnabled).toBe(true);
    expect(result.unknownReason).toBe("FIELD_NOT_AVAILABLE");
    expect(result.confidence).toBe("medium");
  });
});
