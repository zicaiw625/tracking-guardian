import { describe, expect, it } from "vitest";
import { eventValidationMiddleware } from "../../../app/lib/pixel-events/middleware/event-validation.middleware";

describe("eventValidationMiddleware", () => {
  it("uses first validated event timestamp as batch timestamp", async () => {
    const expiredTimestamp = Date.now() - 30 * 60 * 1000;
    const validTimestamp = Date.now();
    const context = {
      request: new Request("https://example.com/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }),
      requestId: "req-1",
      isProduction: false,
      allowFallback: false,
      origin: "https://demo-shop.myshopify.com",
      isNullOrigin: false,
      originHeaderPresent: true,
      signature: null,
      hasSignatureHeader: false,
      bodySignature: null,
      hasBodySignature: false,
      timestampHeader: null,
      bodySignatureTimestamp: null,
      timestamp: null,
      shopDomainHeader: "demo-shop.myshopify.com",
      bodySignatureShopDomain: null,
      signatureSource: "none",
      contentType: "application/json",
      strictOrigin: false,
      allowUnsignedEvents: true,
      bodyText: null,
      bodyData: null,
      rawEvents: [
        {
          eventName: "checkout_completed",
          timestamp: expiredTimestamp,
          shopDomain: "demo-shop.myshopify.com",
          data: {
            orderId: "gid://shopify/Order/1",
            value: 1,
            currency: "USD",
          },
        },
        {
          eventName: "checkout_completed",
          timestamp: validTimestamp,
          shopDomain: "demo-shop.myshopify.com",
          data: {
            orderId: "gid://shopify/Order/2",
            value: 2,
            currency: "USD",
          },
        },
      ],
      batchTimestamp: undefined,
      validatedEvents: [],
      shopDomain: null,
      environment: "live",
      shop: null,
      shopAllowedDomains: [],
      keyValidation: { matched: false, reason: "signature_missing", trustLevel: "untrusted" },
      mode: "purchase_only",
      enabledPixelConfigs: [],
    } as any;

    const result = await eventValidationMiddleware(context);
    expect(result.continue).toBe(true);
    if (!result.continue) {
      return;
    }
    expect(result.context.validatedEvents).toHaveLength(1);
    expect(result.context.batchTimestamp).toBe(validTimestamp);
    expect(result.context.timestamp).toBe(validTimestamp);
  });
});
