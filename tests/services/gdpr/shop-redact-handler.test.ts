import { beforeEach, describe, expect, it, vi } from "vitest";
import { processShopRedact } from "../../../app/services/gdpr/handlers/shop-redact";

const deleteManyGdprMock = vi.fn();

vi.mock("../../../app/db.server", () => ({
  default: {
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) =>
      fn({
        webhookLog: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        gDPRJob: { deleteMany: deleteManyGdprMock.mockResolvedValue({ count: 2 }) },
        session: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        shop: {
          findUnique: vi.fn().mockResolvedValue({ id: "shop_1" }),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        pixelEventReceipt: { count: vi.fn().mockResolvedValue(0) },
        verificationRun: { count: vi.fn().mockResolvedValue(0) },
        scanReport: { count: vi.fn().mockResolvedValue(0) },
        auditAsset: { count: vi.fn().mockResolvedValue(0) },
        pixelConfig: { count: vi.fn().mockResolvedValue(0) },
      })
    ),
  },
}));

vi.mock("../../../app/utils/logger.server", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("processShopRedact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not delete GDPR jobs currently in processing status", async () => {
    await processShopRedact("test-shop.myshopify.com", {
      shop_id: 1,
      shop_domain: "test-shop.myshopify.com",
    });

    expect(deleteManyGdprMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopDomain: "test-shop.myshopify.com",
          status: { not: "processing" },
        }),
      })
    );
  });
});
