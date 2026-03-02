import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  shop: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  orderSummary: {
    count: vi.fn(),
  },
}));

vi.mock("../../../app/db.server", () => ({ default: mockPrisma }));

import {
  assertOrderDataAvailability,
  getOrderDataAvailability,
  getOrderDataModeFromSettings,
  hasOrderData,
  isOrderDataUnavailableError,
} from "../../../app/services/orders/order-data-mode.server";

describe("order-data-mode service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads orderDataMode from settings safely", () => {
    expect(getOrderDataModeFromSettings({ orderDataMode: "manual_import" })).toBe("manual_import");
    expect(getOrderDataModeFromSettings({ orderDataMode: "pcd_webhook" })).toBe("pcd_webhook");
    expect(getOrderDataModeFromSettings({ orderDataMode: "unexpected" })).toBe("none");
    expect(getOrderDataModeFromSettings(null)).toBe("none");
  });

  it("returns enabled=true only when mode enabled and summary count > 0", async () => {
    vi.mocked(mockPrisma.shop.findUnique).mockResolvedValue({ settings: { orderDataMode: "manual_import" } });
    vi.mocked(mockPrisma.orderSummary.count).mockResolvedValue(5);

    const result = await getOrderDataAvailability("shop-1", 7);

    expect(result).toEqual({
      mode: "manual_import",
      summaryCountLastNDays: 5,
      enabled: true,
    });
    expect(await hasOrderData("shop-1", 7)).toBe(true);
  });

  it("returns enabled=false when mode none or count is zero", async () => {
    vi.mocked(mockPrisma.shop.findUnique).mockResolvedValue({ settings: { orderDataMode: "none" } });
    vi.mocked(mockPrisma.orderSummary.count).mockResolvedValue(0);

    const result = await getOrderDataAvailability("shop-1", 7);

    expect(result.enabled).toBe(false);
    expect(result.mode).toBe("none");
    expect(result.summaryCountLastNDays).toBe(0);
  });

  it("throws identifiable error when availability is not ready", () => {
    try {
      assertOrderDataAvailability({
        mode: "none",
        summaryCountLastNDays: 0,
        enabled: false,
      });
      throw new Error("Expected assertOrderDataAvailability to throw");
    } catch (error) {
      expect(isOrderDataUnavailableError(error)).toBe(true);
      expect((error as { code: string }).code).toContain("PCD_ORDER_UNAVAILABLE");
    }

    try {
      assertOrderDataAvailability({
        mode: "manual_import",
        summaryCountLastNDays: 0,
        enabled: false,
      });
    } catch (error) {
      expect(isOrderDataUnavailableError(error)).toBe(true);
    }
  });
});
