import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

type Handler = (event: unknown) => void;

describe("tracking pixel events", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes all_standard_events in full_funnel and routes page_viewed", async () => {
    const handlers = new Map<string, Handler>();
    const analytics = {
      subscribe: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, handler);
        return Promise.resolve(undefined);
      }),
    };
    const sendToBackend = vi.fn().mockResolvedValue(undefined);
    const { subscribeToAnalyticsEvents } = await import("../../extensions/tracking-pixel/src/events");
    const occurredAtIso = "2026-01-02T03:04:05.000Z";

    subscribeToAnalyticsEvents(analytics, sendToBackend, undefined, "full_funnel");
    expect(analytics.subscribe).toHaveBeenCalledWith("all_standard_events", expect.any(Function));

    handlers.get("all_standard_events")?.({
      name: "page_viewed",
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

  it("subscribes checkout_completed only in purchase_only mode", async () => {
    const handlers = new Map<string, Handler>();
    const analytics = {
      subscribe: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, handler);
        return Promise.resolve(undefined);
      }),
    };
    const sendToBackend = vi.fn().mockResolvedValue(undefined);
    const { subscribeToAnalyticsEvents } = await import("../../extensions/tracking-pixel/src/events");

    subscribeToAnalyticsEvents(analytics, sendToBackend, undefined, "purchase_only");

    expect(analytics.subscribe).toHaveBeenCalledTimes(1);
    expect(analytics.subscribe).toHaveBeenCalledWith("checkout_completed", expect.any(Function));
    expect(handlers.has("all_standard_events")).toBe(false);
  });

  it("is idempotent for repeated full_funnel subscription", async () => {
    const analytics = {
      subscribe: vi.fn(() => Promise.resolve(undefined)),
    };
    const sendToBackend = vi.fn().mockResolvedValue(undefined);
    const { subscribeToAnalyticsEvents } = await import("../../extensions/tracking-pixel/src/events");

    subscribeToAnalyticsEvents(analytics, sendToBackend, undefined, "full_funnel");
    subscribeToAnalyticsEvents(analytics, sendToBackend, undefined, "full_funnel");

    expect(analytics.subscribe).toHaveBeenCalledTimes(1);
    expect(analytics.subscribe).toHaveBeenCalledWith("all_standard_events", expect.any(Function));
  });

  it("handles subscribe rejection without throwing", async () => {
    const analytics = {
      subscribe: vi.fn(() => Promise.reject(new Error("subscribe failed"))),
    };
    const sendToBackend = vi.fn().mockResolvedValue(undefined);
    const logger = vi.fn();
    const { subscribeToAnalyticsEvents } = await import("../../extensions/tracking-pixel/src/events");

    expect(() => {
      subscribeToAnalyticsEvents(analytics, sendToBackend, logger, "full_funnel");
    }).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();
    expect(logger).toHaveBeenCalled();
  });
});
