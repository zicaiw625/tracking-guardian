

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type TypOspStatus = "enabled" | "disabled" | "unknown";
type TypOspUnknownReason =
  | "NOT_PLUS"
  | "NO_EDITOR_ACCESS"
  | "API_ERROR"
  | "RATE_LIMIT"
  | "NO_PROFILES"
  | "FIELD_NOT_AVAILABLE"
  | "NO_ADMIN_CONTEXT";

interface TypOspStatusResult {
  status: TypOspStatus;
  typOspPagesEnabled: boolean | null;
  unknownReason?: TypOspUnknownReason;
  confidence: "high" | "medium" | "low";
  error?: string;
}

interface CheckoutProfileNode {
  id: string;
  name: string;
  isPublished: boolean;
  typOspPagesActive?: boolean;
}

interface GraphQLResponse {
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
  errors?: Array<{ message: string }>;
}

function parseTypOspFromResponse(response: GraphQLResponse): TypOspStatusResult {

  if (response.errors) {
    const errorMessages = response.errors.map(e => e.message || "").join(" ");

    if (errorMessages.includes("access") || errorMessages.includes("permission")) {
      return {
        status: "unknown",
        typOspPagesEnabled: null,
        unknownReason: "NO_EDITOR_ACCESS",
        confidence: "low",
        error: "Requires access to checkout and accounts editor",
      };
    }

    if (errorMessages.includes("rate") || errorMessages.includes("throttle")) {
      return {
        status: "unknown",
        typOspPagesEnabled: null,
        unknownReason: "RATE_LIMIT",
        confidence: "low",
        error: "Rate limited, try again later",
      };
    }

    return {
      status: "unknown",
      typOspPagesEnabled: null,
      unknownReason: "API_ERROR",
      confidence: "low",
      error: errorMessages.substring(0, 200),
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
        error: "Non-Plus shops may not have checkoutProfiles access",
      };
    }

    return {
      status: "unknown",
      typOspPagesEnabled: null,
      unknownReason: "NO_PROFILES",
      confidence: "low",
      error: "No checkout profiles returned",
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

  const publishedProfiles = profiles.filter(p => p.isPublished === true);
  const hasTypOspActive = publishedProfiles.some(p => p.typOspPagesActive === true);

  return {
    status: hasTypOspActive ? "enabled" : "disabled",
    typOspPagesEnabled: hasTypOspActive,
    confidence: "high",
  };
}

describe("checkoutProfiles typOspPagesActive 解析", () => {
  describe("Plus 商家 - 已升级到新版页面", () => {
    it("published + typOspPagesActive=true → enabled", () => {
      const response: GraphQLResponse = {
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

      const result = parseTypOspFromResponse(response);

      expect(result.status).toBe("enabled");
      expect(result.typOspPagesEnabled).toBe(true);
      expect(result.confidence).toBe("high");
      expect(result.unknownReason).toBeUndefined();
    });
  });

  describe("Plus 商家 - 未升级到新版页面", () => {
    it("published + typOspPagesActive=false → disabled", () => {
      const response: GraphQLResponse = {
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

      const result = parseTypOspFromResponse(response);

      expect(result.status).toBe("disabled");
      expect(result.typOspPagesEnabled).toBe(false);
      expect(result.confidence).toBe("high");
    });

    it("多个 profiles，只要有一个 published+active 就是 enabled", () => {
      const response: GraphQLResponse = {
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
                name: "Custom",
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

      const result = parseTypOspFromResponse(response);

      expect(result.status).toBe("enabled");
      expect(result.typOspPagesEnabled).toBe(true);
    });

    it("未发布的 profile 不计入判断", () => {
      const response: GraphQLResponse = {
        data: {
          checkoutProfiles: {
            nodes: [
              {
                id: "gid://shopify/CheckoutProfile/1",
                name: "Draft",
                isPublished: false,
                typOspPagesActive: true,
              },
              {
                id: "gid://shopify/CheckoutProfile/2",
                name: "Published",
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

      const result = parseTypOspFromResponse(response);

      expect(result.status).toBe("disabled");
      expect(result.typOspPagesEnabled).toBe(false);
    });
  });

  describe("权限不足场景", () => {
    it("NO_EDITOR_ACCESS - 权限错误", () => {
      const response: GraphQLResponse = {
        errors: [
          { message: "You do not have access to checkout and accounts editor" },
        ],
      };

      const result = parseTypOspFromResponse(response);

      expect(result.status).toBe("unknown");
      expect(result.typOspPagesEnabled).toBe(null);
      expect(result.unknownReason).toBe("NO_EDITOR_ACCESS");
      expect(result.confidence).toBe("low");
    });

    it("NOT_PLUS - 非 Plus 商家无 profiles", () => {
      const response: GraphQLResponse = {
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

      const result = parseTypOspFromResponse(response);

      expect(result.status).toBe("unknown");
      expect(result.unknownReason).toBe("NOT_PLUS");
      expect(result.confidence).toBe("medium");
    });
  });

  describe("API 错误场景", () => {
    it("RATE_LIMIT - API 限流", () => {
      const response: GraphQLResponse = {
        errors: [
          { message: "rate limit exceeded, throttle request" },
        ],
      };

      const result = parseTypOspFromResponse(response);

      expect(result.status).toBe("unknown");
      expect(result.unknownReason).toBe("RATE_LIMIT");
      expect(result.confidence).toBe("low");
    });

    it("API_ERROR - 一般 API 错误", () => {
      const response: GraphQLResponse = {
        errors: [
          { message: "Internal server error" },
        ],
      };

      const result = parseTypOspFromResponse(response);

      expect(result.status).toBe("unknown");
      expect(result.unknownReason).toBe("API_ERROR");
      expect(result.confidence).toBe("low");
    });
  });

  describe("字段缺失降级", () => {
    it("FIELD_NOT_AVAILABLE - 降级到 checkoutApiSupported", () => {
      const response: GraphQLResponse = {
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

      const result = parseTypOspFromResponse(response);

      expect(result.status).toBe("enabled");
      expect(result.typOspPagesEnabled).toBe(true);
      expect(result.unknownReason).toBe("FIELD_NOT_AVAILABLE");
      expect(result.confidence).toBe("medium");
    });
  });
});

describe("状态变更检测", () => {
  it("从 disabled 变为 enabled 应该被检测到", () => {
    const oldStatus = { typOspPagesEnabled: false };
    const newResult = parseTypOspFromResponse({
      data: {
        checkoutProfiles: {
          nodes: [
            { id: "1", name: "Default", isPublished: true, typOspPagesActive: true },
          ],
        },
        shop: { checkoutApiSupported: true, plan: { shopifyPlus: true } },
      },
    });

    const hasChanged = newResult.typOspPagesEnabled !== oldStatus.typOspPagesEnabled;
    expect(hasChanged).toBe(true);
  });
});
