/**
 * Tracking Guardian - Web Pixel Extension
 * 
 * Features:
 * - Multi-platform tracking (Google, Meta, TikTok, Bing)
 * - Error isolation: one platform failure doesn't affect others
 * - Event queuing: events fired before SDK loads are queued and replayed
 * - Idempotency: prevents double initialization
 * - Null-safe: handles missing data gracefully
 */

import { register } from "@shopify/web-pixels-extension";

// Type definitions for platform SDKs
interface PlatformState {
  initialized: boolean;
  ready: boolean;
  queue: Array<{ method: string; args: unknown[] }>;
}

register(({ analytics, browser, settings }) => {
  // Get platform settings
  const googleMeasurementId = settings.google_measurement_id as string | undefined;
  const googleConversionId = settings.google_conversion_id as string | undefined;
  const googleConversionLabel = settings.google_conversion_label as string | undefined;
  const metaPixelId = settings.meta_pixel_id as string | undefined;
  const tiktokPixelId = settings.tiktok_pixel_id as string | undefined;
  const bingTagId = settings.bing_tag_id as string | undefined;

  // Platform initialization state tracking
  const platformState: Record<string, PlatformState> = {
    google: { initialized: false, ready: false, queue: [] },
    meta: { initialized: false, ready: false, queue: [] },
    tiktok: { initialized: false, ready: false, queue: [] },
    bing: { initialized: false, ready: false, queue: [] },
  };

  /**
   * Safely execute a platform-specific tracking call
   * Isolates errors so one platform failure doesn't affect others
   */
  function safeTrack(platformName: string, trackFn: () => void): void {
    try {
      trackFn();
    } catch (error) {
      // Log error but don't throw - isolate platform failures
      console.error(`[Tracking Guardian] ${platformName} tracking error:`, error);
    }
  }

  /**
   * Queue an event for a platform that isn't ready yet
   */
  function queueOrExecute(
    platform: string,
    method: string,
    executor: () => void
  ): void {
    const state = platformState[platform];
    if (!state) return;

    if (state.ready) {
      safeTrack(platform, executor);
    } else {
      state.queue.push({ method, args: [] });
      // Store the actual executor for replay
      (state.queue[state.queue.length - 1] as any).executor = executor;
    }
  }

  /**
   * Flush queued events for a platform
   */
  function flushQueue(platform: string): void {
    const state = platformState[platform];
    if (!state) return;

    const queue = [...state.queue];
    state.queue = [];

    queue.forEach((item: any) => {
      if (item.executor) {
        safeTrack(platform, item.executor);
      }
    });
  }

  // ==========================================
  // GOOGLE ANALYTICS 4 & GOOGLE ADS
  // ==========================================
  if (googleMeasurementId && !platformState.google.initialized) {
    platformState.google.initialized = true;

    // Initialize gtag
    const gtagScript = browser.document.createElement("script");
    gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${googleMeasurementId}`;
    gtagScript.async = true;
    
    gtagScript.onload = () => {
      platformState.google.ready = true;
      flushQueue("google");
    };
    
    browser.document.head.appendChild(gtagScript);

    (browser.window as any).dataLayer = (browser.window as any).dataLayer || [];
    function gtag(...args: any[]) {
      (browser.window as any).dataLayer.push(args);
    }
    (browser.window as any).gtag = gtag;

    gtag("js", new Date());
    gtag("config", googleMeasurementId);

    if (googleConversionId) {
      gtag("config", googleConversionId);
    }
    
    // Mark as ready after initial config (gtag queues internally anyway)
    platformState.google.ready = true;
  }

  // ==========================================
  // META (FACEBOOK) PIXEL
  // ==========================================
  if (metaPixelId && !platformState.meta.initialized) {
    platformState.meta.initialized = true;

    (function (f: any, b: any, e: any, v: any, n?: any, t?: any, s?: any) {
      if (f.fbq) {
        platformState.meta.ready = true;
        return;
      }
      n = f.fbq = function () {
        n.callMethod
          ? n.callMethod.apply(n, arguments)
          : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      t.onload = () => {
        platformState.meta.ready = true;
        flushQueue("meta");
      };
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(
      browser.window,
      browser.document,
      "script",
      "https://connect.facebook.net/en_US/fbevents.js"
    );

    (browser.window as any).fbq("init", metaPixelId);
    (browser.window as any).fbq("track", "PageView");
    
    // fbq queues internally, so we can mark as ready
    platformState.meta.ready = true;
  }

  // ==========================================
  // TIKTOK PIXEL
  // ==========================================
  if (tiktokPixelId && !platformState.tiktok.initialized) {
    platformState.tiktok.initialized = true;

    (function (w: any, d: any, t: any) {
      if (w.ttq) {
        platformState.tiktok.ready = true;
        return;
      }
      w.TiktokAnalyticsObject = t;
      const ttq = (w[t] = w[t] || []);
      ttq.methods = [
        "page", "track", "identify", "instances", "debug",
        "on", "off", "once", "ready", "alias", "group",
        "enableCookie", "disableCookie",
      ];
      ttq.setAndDefer = function (t: any, e: any) {
        t[e] = function () {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (let i = 0; i < ttq.methods.length; i++)
        ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function (t: any) {
        const e = ttq._i[t] || [];
        for (let n = 0; n < ttq.methods.length; n++)
          ttq.setAndDefer(e, ttq.methods[n]);
        return e;
      };
      ttq.load = function (e: any, n: any) {
        const i = "https://analytics.tiktok.com/i18n/pixel/events.js";
        ttq._i = ttq._i || {};
        ttq._i[e] = [];
        ttq._i[e]._u = i;
        ttq._t = ttq._t || {};
        ttq._t[e] = +new Date();
        ttq._o = ttq._o || {};
        ttq._o[e] = n || {};
        const o = d.createElement("script");
        o.type = "text/javascript";
        o.async = true;
        o.src = i + "?sdkid=" + e + "&lib=" + t;
        o.onload = () => {
          platformState.tiktok.ready = true;
          flushQueue("tiktok");
        };
        const a = d.getElementsByTagName("script")[0];
        a.parentNode.insertBefore(o, a);
      };
      ttq.load(tiktokPixelId);
      ttq.page();
    })(browser.window, browser.document, "ttq");

    // ttq queues internally
    platformState.tiktok.ready = true;
  }

  // ==========================================
  // MICROSOFT ADVERTISING UET
  // ==========================================
  if (bingTagId && !platformState.bing.initialized) {
    platformState.bing.initialized = true;

    (function (w: any, d: any, t: any, r: any, u: any) {
      if (w.uetq && w.uetq.push) {
        platformState.bing.ready = true;
        return;
      }
      let f: any, n: any, i: any;
      w[u] = w[u] || [];
      f = function () {
        const o = { ti: bingTagId };
        (o as any).q = w[u];
        w[u] = new (w as any).UET(o);
        w[u].push("pageLoad");
        platformState.bing.ready = true;
        flushQueue("bing");
      };
      n = d.createElement(t);
      n.src = r;
      n.async = 1;
      n.onload = n.onreadystatechange = function () {
        const s = this.readyState;
        if (s && s !== "loaded" && s !== "complete") return;
        f();
        n.onload = n.onreadystatechange = null;
      };
      i = d.getElementsByTagName(t)[0];
      i.parentNode.insertBefore(n, i);
    })(browser.window, browser.document, "script", "//bat.bing.com/bat.js", "uetq");
  }

  // ==========================================
  // EVENT TRACKING - with error isolation
  // ==========================================

  // Page View
  analytics.subscribe("page_viewed", (event) => {
    if (googleMeasurementId) {
      safeTrack("google", () => {
        (browser.window as any).gtag?.("event", "page_view", {
          page_title: event.context?.document?.title || "",
          page_location: event.context?.document?.location?.href || "",
        });
      });
    }
  });

  // Product Viewed
  analytics.subscribe("product_viewed", (event) => {
    const product = event.data?.productVariant;
    if (!product) return;

    const currency = product.price?.currencyCode || "USD";
    const value = parseFloat(product.price?.amount || "0");

    if (googleMeasurementId) {
      safeTrack("google", () => {
        (browser.window as any).gtag?.("event", "view_item", {
          currency,
          value,
          items: [{
            item_id: product.id,
            item_name: product.title,
            price: value,
          }],
        });
      });
    }

    if (metaPixelId) {
      safeTrack("meta", () => {
        (browser.window as any).fbq?.("track", "ViewContent", {
          content_ids: [product.id],
          content_name: product.title,
          content_type: "product",
          value,
          currency,
        });
      });
    }

    if (tiktokPixelId) {
      safeTrack("tiktok", () => {
        (browser.window as any).ttq?.track("ViewContent", {
          content_id: product.id,
          content_name: product.title,
          content_type: "product",
          value,
          currency,
        });
      });
    }

    if (bingTagId) {
      safeTrack("bing", () => {
        (browser.window as any).uetq?.push("event", "view_item", {
          ecomm_prodid: product.id,
          ecomm_pagetype: "product",
          revenue_value: value,
          currency,
        });
      });
    }
  });

  // Add to Cart
  analytics.subscribe("product_added_to_cart", (event) => {
    const item = event.data?.cartLine;
    if (!item?.merchandise) return;

    const currency = item.merchandise.price?.currencyCode || "USD";
    const price = parseFloat(item.merchandise.price?.amount || "0");
    const quantity = item.quantity || 1;
    const value = price * quantity;

    if (googleMeasurementId) {
      safeTrack("google", () => {
        (browser.window as any).gtag?.("event", "add_to_cart", {
          currency,
          value,
          items: [{
            item_id: item.merchandise.id,
            item_name: item.merchandise.title,
            price,
            quantity,
          }],
        });
      });
    }

    if (metaPixelId) {
      safeTrack("meta", () => {
        (browser.window as any).fbq?.("track", "AddToCart", {
          content_ids: [item.merchandise.id],
          content_name: item.merchandise.title,
          content_type: "product",
          value,
          currency,
        });
      });
    }

    if (tiktokPixelId) {
      safeTrack("tiktok", () => {
        (browser.window as any).ttq?.track("AddToCart", {
          content_id: item.merchandise.id,
          content_name: item.merchandise.title,
          content_type: "product",
          value,
          currency,
          quantity,
        });
      });
    }

    if (bingTagId) {
      safeTrack("bing", () => {
        (browser.window as any).uetq?.push("event", "add_to_cart", {
          ecomm_prodid: item.merchandise.id,
          revenue_value: value,
          currency,
        });
      });
    }
  });

  // Checkout Started
  analytics.subscribe("checkout_started", (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;

    const currency = checkout.currencyCode || "USD";
    const value = parseFloat(checkout.totalPrice?.amount || "0");
    const lineItems = checkout.lineItems || [];

    if (googleMeasurementId) {
      safeTrack("google", () => {
        (browser.window as any).gtag?.("event", "begin_checkout", {
          currency,
          value,
          items: lineItems.map((item) => ({
            item_id: item.id,
            item_name: item.title,
            price: parseFloat(item.variant?.price?.amount || "0"),
            quantity: item.quantity || 1,
          })),
        });
      });
    }

    if (metaPixelId) {
      safeTrack("meta", () => {
        (browser.window as any).fbq?.("track", "InitiateCheckout", {
          content_ids: lineItems.map((item) => item.id),
          contents: lineItems.map((item) => ({
            id: item.id,
            quantity: item.quantity || 1,
          })),
          content_type: "product",
          value,
          currency,
          num_items: lineItems.reduce((sum, item) => sum + (item.quantity || 1), 0),
        });
      });
    }

    if (tiktokPixelId) {
      safeTrack("tiktok", () => {
        (browser.window as any).ttq?.track("InitiateCheckout", {
          contents: lineItems.map((item) => ({
            content_id: item.id,
            content_name: item.title,
            quantity: item.quantity || 1,
          })),
          content_type: "product",
          value,
          currency,
        });
      });
    }

    if (bingTagId) {
      safeTrack("bing", () => {
        (browser.window as any).uetq?.push("event", "begin_checkout", {
          revenue_value: value,
          currency,
        });
      });
    }
  });

  // Payment Info Submitted
  analytics.subscribe("payment_info_submitted", (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;

    const currency = checkout.currencyCode || "USD";
    const value = parseFloat(checkout.totalPrice?.amount || "0");
    const lineItems = checkout.lineItems || [];

    if (metaPixelId) {
      safeTrack("meta", () => {
        (browser.window as any).fbq?.("track", "AddPaymentInfo", {
          content_ids: lineItems.map((item) => item.id),
          value,
          currency,
        });
      });
    }
  });

  // Purchase Complete
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout;
    if (!checkout) return;

    const currency = checkout.currencyCode || "USD";
    const value = parseFloat(checkout.totalPrice?.amount || "0");
    const transactionId = checkout.order?.id || checkout.token;
    const lineItems = checkout.lineItems || [];

    // Google Analytics 4 Purchase
    if (googleMeasurementId) {
      safeTrack("google", () => {
        (browser.window as any).gtag?.("event", "purchase", {
          transaction_id: transactionId,
          value,
          currency,
          tax: parseFloat(checkout.totalTax?.amount || "0"),
          shipping: parseFloat(checkout.shippingLine?.price?.amount || "0"),
          items: lineItems.map((item) => ({
            item_id: item.id,
            item_name: item.title,
            price: parseFloat(item.variant?.price?.amount || "0"),
            quantity: item.quantity || 1,
          })),
        });

        // Google Ads Conversion
        if (googleConversionId && googleConversionLabel) {
          (browser.window as any).gtag?.("event", "conversion", {
            send_to: `${googleConversionId}/${googleConversionLabel}`,
            value,
            currency,
            transaction_id: transactionId,
          });
        }
      });
    }

    // Meta Purchase
    if (metaPixelId) {
      safeTrack("meta", () => {
        (browser.window as any).fbq?.("track", "Purchase", {
          content_ids: lineItems.map((item) => item.id),
          contents: lineItems.map((item) => ({
            id: item.id,
            quantity: item.quantity || 1,
            item_price: parseFloat(item.variant?.price?.amount || "0"),
          })),
          content_type: "product",
          value,
          currency,
          order_id: transactionId,
          num_items: lineItems.reduce((sum, item) => sum + (item.quantity || 1), 0),
        });
      });
    }

    // TikTok Complete Payment
    if (tiktokPixelId) {
      safeTrack("tiktok", () => {
        (browser.window as any).ttq?.track("CompletePayment", {
          contents: lineItems.map((item) => ({
            content_id: item.id,
            content_name: item.title,
            quantity: item.quantity || 1,
            price: parseFloat(item.variant?.price?.amount || "0"),
          })),
          content_type: "product",
          value,
          currency,
          order_id: transactionId,
        });
      });
    }

    // Microsoft Ads Purchase
    if (bingTagId) {
      safeTrack("bing", () => {
        (browser.window as any).uetq?.push("event", "purchase", {
          revenue_value: value,
          currency,
          transaction_id: transactionId,
        });
      });
    }
  });
});

