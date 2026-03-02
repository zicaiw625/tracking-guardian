import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  orderSummary: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const mockSetOrderDataMode = vi.hoisted(() => vi.fn());

vi.mock("../../../app/db.server", () => ({ default: mockPrisma }));
vi.mock("../../../app/services/orders/order-data-mode.server", async () => {
  const actual = await vi.importActual("../../../app/services/orders/order-data-mode.server");
  return {
    ...actual,
    setOrderDataMode: mockSetOrderDataMode,
  };
});

import { importOrderSummariesFromCsv } from "../../../app/services/orders/manual-import.server";

describe("manual order import service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockPrisma.orderSummary.upsert).mockResolvedValue({ id: "ok" });
    vi.mocked(mockPrisma.$transaction).mockResolvedValue([]);
  });

  it("imports valid rows, skips invalid/duplicate rows, and enables manual mode", async () => {
    const csv = [
      "orderId,total,currency,createdAt",
      "1001,10.50,USD,2026-02-01T10:00:00.000Z",
      "1002,20.00,EUR,2026-02-01T10:10:00.000Z",
      "1002,20.00,EUR,2026-02-01T10:10:00.000Z",
      "1003,not-a-number,USD,2026-02-01T10:20:00.000Z",
    ].join("\n");

    const result = await importOrderSummariesFromCsv("shop-1", csv);

    expect(result).toEqual({
      imported: 2,
      skipped: 2,
      total: 4,
    });
    expect(mockPrisma.orderSummary.upsert).toHaveBeenCalledTimes(2);
    expect(mockSetOrderDataMode).toHaveBeenCalledWith("shop-1", "manual_import");
  });

  it("throws when required header columns are missing", async () => {
    const csv = [
      "orderId,total,currency",
      "1001,10.50,USD",
    ].join("\n");

    await expect(importOrderSummariesFromCsv("shop-1", csv)).rejects.toThrow(
      /Missing required columns/
    );
    expect(mockPrisma.orderSummary.upsert).not.toHaveBeenCalled();
  });

  it("returns zero result for empty payload", async () => {
    const csv = "orderId,total,currency,createdAt\n";
    const result = await importOrderSummariesFromCsv("shop-1", csv);

    expect(result).toEqual({
      imported: 0,
      skipped: 0,
      total: 0,
    });
  });
});
