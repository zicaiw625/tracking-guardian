import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockHandleAppUninstalled = vi.fn();

vi.mock("../../app/webhooks/handlers", () => ({
  handleAppUninstalled: (...args: unknown[]) => mockHandleAppUninstalled(...args),
  handleCustomersDataRequest: vi.fn(),
  handleCustomersRedact: vi.fn(),
  handleShopRedact: vi.fn(),
  handleAppSubscriptionsUpdate: vi.fn(),
}));

const mockTryAcquireWebhookLock = vi.fn();
const mockUpdateWebhookStatus = vi.fn();

vi.mock("../../app/webhooks/middleware", () => ({
  tryAcquireWebhookLock: (...args: unknown[]) => mockTryAcquireWebhookLock(...args),
  updateWebhookStatus: (...args: unknown[]) => mockUpdateWebhookStatus(...args),
}));

import { WebhookStatus } from "../../app/types";
import { dispatchWebhook } from "../../app/webhooks/dispatcher";

describe("dispatchWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTryAcquireWebhookLock.mockResolvedValue({ acquired: true });
    mockHandleAppUninstalled.mockResolvedValue({
      success: true,
      status: 200,
      message: "App uninstalled",
    });
  });

  it("should process APP_UNINSTALLED even without admin context", async () => {
    const response = await dispatchWebhook(
      {
        topic: "APP_UNINSTALLED",
        shop: "demo.myshopify.com",
        webhookId: "whk-1",
        payload: {},
        admin: null,
        session: null,
      } as any,
      {
        id: "shop-1",
      } as any,
      true
    );

    expect(response.status).toBe(200);
    expect(mockHandleAppUninstalled).toHaveBeenCalledOnce();
    expect(mockUpdateWebhookStatus).toHaveBeenCalledWith(
      "demo.myshopify.com",
      "whk-1",
      "APP_UNINSTALLED",
      WebhookStatus.PROCESSED,
      undefined
    );
  });

  it("should mark early-return non-GDPR webhook as processed", async () => {
    const response = await dispatchWebhook(
      {
        topic: "ORDERS_CREATE",
        shop: "demo.myshopify.com",
        webhookId: "whk-2",
        payload: {},
        admin: null,
        session: null,
      } as any,
      null,
      true
    );

    expect(response.status).toBe(200);
    expect(mockHandleAppUninstalled).not.toHaveBeenCalled();
    expect(mockUpdateWebhookStatus).toHaveBeenCalledWith(
      "demo.myshopify.com",
      "whk-2",
      "ORDERS_CREATE",
      WebhookStatus.PROCESSED
    );
  });
});
