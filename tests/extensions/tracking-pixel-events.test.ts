import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { subscribeToAnalyticsEvents } from "../../extensions/tracking-pixel/src/events";

type Handler = (event: unknown) => void;

describe("tracking pixel events", () => {
  const handlers = new Map<string, Handler>();

  const analytics = {
    subscribe: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
  };

  beforeEach(() => {
    handlers.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends page_viewed when only context exists", () => {
    const sendToBackend = vi.fn().mockResolvedValue(undefined);
    const occurredAtIso = "2026-01-02T03:04:05.000Z";

    subscribeToAnalyticsEvents(analytics, sendToBackend, undefined, "full_funnel");

    const handler = handlers.get("page_viewed");
    expect(handler).toBeTypeOf("function");

    handler?.({
      id: "pv-1",
      timestamp: occurredAtIso,
      context: {
        document: {
          location: { href: "https://store.example/products/a?x=1#hash" },
          title: "Product A",
        },
      },
      data: {},
    });

    expect(sendToBackend).toHaveBeenCalledTimes(1);
    expect(sendToBackend).toHaveBeenCalledWith(
      "page_viewed",
      expect.objectContaining({
        url: "https://store.example/products/a?x=1#hash",
        title: "Product A",
      }),
      "pv-1",
      Date.parse(occurredAtIso)
    );
  });

  it("adds url and title to checkout funnel event payload", () => {
    const sendToBackend = vi.fn().mockResolvedValue(undefined);

    subscribeToAnalyticsEvents(analytics, sendToBackend, undefined, "full_funnel");

    const handler = handlers.get("checkout_started");
    expect(handler).toBeTypeOf("function");

    handler?.({
      id: "co-1",
      timestamp: "2026-02-03T04:05:06.000Z",
      context: {
        document: {
          location: { href: "https://store.example/checkouts/abc" },
          title: "Checkout",
        },
      },
      data: {
        checkout: {
          token: "token_12345678",
          totalPrice: { amount: "19.99" },
          currencyCode: "USD",
          lineItems: [],
        },
      },
    });

    expect(sendToBackend).toHaveBeenCalledTimes(1);
    expect(sendToBackend.mock.calls[0][1]).toMatchObject({
      url: "https://store.example/checkouts/abc",
      title: "Checkout",
    });
  });

  it("falls back to current time when event timestamp is missing", () => {
    const sendToBackend = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-03-04T05:06:07.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    subscribeToAnalyticsEvents(analytics, sendToBackend, undefined, "full_funnel");
    const handler = handlers.get("page_viewed");
    expect(handler).toBeTypeOf("function");

    handler?.({
      id: "pv-2",
      context: {
        document: {
          location: { href: "https://store.example/" },
          title: "Home",
        },
      },
      data: {},
    });

    expect(sendToBackend).toHaveBeenCalledTimes(1);
    expect(sendToBackend.mock.calls[0][3]).toBe(now.getTime());
  });
});
