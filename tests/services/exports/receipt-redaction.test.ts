import { describe, it, expect } from "vitest";
import { buildEvidenceRow, redactReceiptPayload } from "../../../app/services/exports/receipt-redaction.server";

describe("receipt redaction service", () => {
  it("keeps allowlist fields and strips sensitive payload fields", () => {
    const payload = {
      eventName: "purchase",
      eventId: "evt-1",
      data: {
        orderId: "gid://shopify/Order/123",
        value: 99.5,
        currency: "USD",
        email: "private@example.com",
        phone: "+123456789",
        address: "secret",
        items: [{ id: "sku-1", quantity: 2, price: 49.75, email: "hidden@x.com" }],
      },
      consent: { analytics: true, marketing: false },
    };

    const redacted = redactReceiptPayload(payload as any);
    const serialized = JSON.stringify(redacted);

    expect(redacted).toHaveProperty("eventName", "purchase");
    expect(redacted).toHaveProperty("data.itemsCount", 1);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("+123456789");
    expect(serialized).not.toContain("secret");
  });

  it("builds evidence row with hashed order key and summary fields", () => {
    const row = buildEvidenceRow({
      eventType: "purchase",
      platform: "meta",
      pixelTimestamp: new Date("2026-03-01T12:00:00.000Z"),
      orderKey: "order-abc-123",
      totalValue: null as any,
      currency: null,
      hmacMatched: true,
      trustLevel: "trusted",
      payloadJson: {
        eventName: "purchase",
        data: {
          value: 120.33,
          currency: "USD",
          items: [{ id: "SKU-1", quantity: 1 }],
        },
      } as any,
    });

    expect(row.eventType).toBe("purchase");
    expect(row.platform).toBe("meta");
    expect(row.orderKeyHash).toBeTruthy();
    expect(row.orderKeyHash).not.toBe("order-abc-123");
    expect(row.value).toBe(120.33);
    expect(row.currency).toBe("USD");
    expect(row.itemsCount).toBe(1);
    expect(row.hmacMatched).toBe(true);
  });
});
