import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, settings, init }) => {
  // Get platform settings
  const googleMeasurementId = settings.google_measurement_id;
  const googleConversionId = settings.google_conversion_id;
  const googleConversionLabel = settings.google_conversion_label;
  const metaPixelId = settings.meta_pixel_id;
  const tiktokPixelId = settings.tiktok_pixel_id;
  const bingTagId = settings.bing_tag_id;

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

  // ==========================================
  // GOOGLE ANALYTICS 4 & GOOGLE ADS
  // ==========================================
  if (googleMeasurementId) {
    // Initialize gtag
    const gtagScript = browser.document.createElement("script");
    gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${googleMeasurementId}`;
    gtagScript.async = true;
    browser.document.head.appendChild(gtagScript);

    (browser.window as any).dataLayer = (browser.window as any).dataLayer || [];
    function gtag(...args: any[]) {
      (browser.window as any).dataLayer.push(args);
    }
    (browser.window as any).gtag = gtag;

    gtag("js", new Date());
    gtag("config", googleMeasurementId);

    // Google Ads config if provided
    if (googleConversionId) {
      gtag("config", googleConversionId);
    }
  }

  // ==========================================
  // META (FACEBOOK) PIXEL
  // ==========================================
  if (metaPixelId) {
    // Initialize Meta Pixel
    (function (f: any, b: any, e: any, v: any, n?: any, t?: any, s?: any) {
      if (f.fbq) return;
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
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(
      browser.window,
      browser.document,
      "script",
      "https://connect.facebook.net/en_US/fbevents.js"
    );

    const fbq = (browser.window as any).fbq;
    fbq("init", metaPixelId);
    fbq("track", "PageView");
  }

  // ==========================================
  // TIKTOK PIXEL
  // ==========================================
  if (tiktokPixelId) {
    (function (w: any, d: any, t: any) {
      w.TiktokAnalyticsObject = t;
      const ttq = (w[t] = w[t] || []);
      ttq.methods = [
        "page",
        "track",
        "identify",
        "instances",
        "debug",
        "on",
        "off",
        "once",
        "ready",
        "alias",
        "group",
        "enableCookie",
        "disableCookie",
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
        const a = d.getElementsByTagName("script")[0];
        a.parentNode.insertBefore(o, a);
      };
      ttq.load(tiktokPixelId);
      ttq.page();
    })(browser.window, browser.document, "ttq");
  }

  // ==========================================
  // MICROSOFT ADVERTISING UET
  // ==========================================
  if (bingTagId) {
    (function (w: any, d: any, t: any, r: any, u: any) {
      let f: any, n: any, i: any;
      w[u] = w[u] || [];
      f = function () {
        const o = { ti: bingTagId };
        (o as any).q = w[u];
        w[u] = new (w as any).UET(o);
        w[u].push("pageLoad");
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
  // EVENT TRACKING
  // ==========================================

  // Page View
  analytics.subscribe("page_viewed", (event) => {
    if (googleMeasurementId) {
      (browser.window as any).gtag?.("event", "page_view", {
        page_title: event.context.document.title,
        page_location: event.context.document.location.href,
      });
    }
  });

  // Product Viewed
  analytics.subscribe("product_viewed", (event) => {
    const product = event.data.productVariant;

    if (googleMeasurementId) {
      (browser.window as any).gtag?.("event", "view_item", {
        currency: product.price.currencyCode,
        value: parseFloat(product.price.amount),
        items: [
          {
            item_id: product.id,
            item_name: product.title,
            price: parseFloat(product.price.amount),
          },
        ],
      });
    }

    if (metaPixelId) {
      (browser.window as any).fbq?.("track", "ViewContent", {
        content_ids: [product.id],
        content_name: product.title,
        content_type: "product",
        value: parseFloat(product.price.amount),
        currency: product.price.currencyCode,
      });
    }

    if (tiktokPixelId) {
      (browser.window as any).ttq?.track("ViewContent", {
        content_id: product.id,
        content_name: product.title,
        content_type: "product",
        value: parseFloat(product.price.amount),
        currency: product.price.currencyCode,
      });
    }

    if (bingTagId) {
      (browser.window as any).uetq?.push("event", "view_item", {
        ecomm_prodid: product.id,
        ecomm_pagetype: "product",
        revenue_value: parseFloat(product.price.amount),
        currency: product.price.currencyCode,
      });
    }
  });

  // Add to Cart
  analytics.subscribe("product_added_to_cart", (event) => {
    const item = event.data.cartLine;
    const value = parseFloat(item.merchandise.price.amount) * item.quantity;

    if (googleMeasurementId) {
      (browser.window as any).gtag?.("event", "add_to_cart", {
        currency: item.merchandise.price.currencyCode,
        value,
        items: [
          {
            item_id: item.merchandise.id,
            item_name: item.merchandise.title,
            price: parseFloat(item.merchandise.price.amount),
            quantity: item.quantity,
          },
        ],
      });
    }

    if (metaPixelId) {
      (browser.window as any).fbq?.("track", "AddToCart", {
        content_ids: [item.merchandise.id],
        content_name: item.merchandise.title,
        content_type: "product",
        value,
        currency: item.merchandise.price.currencyCode,
      });
    }

    if (tiktokPixelId) {
      (browser.window as any).ttq?.track("AddToCart", {
        content_id: item.merchandise.id,
        content_name: item.merchandise.title,
        content_type: "product",
        value,
        currency: item.merchandise.price.currencyCode,
        quantity: item.quantity,
      });
    }

    if (bingTagId) {
      (browser.window as any).uetq?.push("event", "add_to_cart", {
        ecomm_prodid: item.merchandise.id,
        revenue_value: value,
        currency: item.merchandise.price.currencyCode,
      });
    }
  });

  // Checkout Started
  analytics.subscribe("checkout_started", (event) => {
    const checkout = event.data.checkout;
    const value = parseFloat(checkout.totalPrice.amount);

    if (googleMeasurementId) {
      (browser.window as any).gtag?.("event", "begin_checkout", {
        currency: checkout.currencyCode,
        value,
        items: checkout.lineItems.map((item) => ({
          item_id: item.id,
          item_name: item.title,
          price: parseFloat(item.variant?.price?.amount || "0"),
          quantity: item.quantity,
        })),
      });
    }

    if (metaPixelId) {
      (browser.window as any).fbq?.("track", "InitiateCheckout", {
        content_ids: checkout.lineItems.map((item) => item.id),
        contents: checkout.lineItems.map((item) => ({
          id: item.id,
          quantity: item.quantity,
        })),
        content_type: "product",
        value,
        currency: checkout.currencyCode,
        num_items: checkout.lineItems.reduce((sum, item) => sum + item.quantity, 0),
      });
    }

    if (tiktokPixelId) {
      (browser.window as any).ttq?.track("InitiateCheckout", {
        contents: checkout.lineItems.map((item) => ({
          content_id: item.id,
          content_name: item.title,
          quantity: item.quantity,
        })),
        content_type: "product",
        value,
        currency: checkout.currencyCode,
      });
    }

    if (bingTagId) {
      (browser.window as any).uetq?.push("event", "begin_checkout", {
        revenue_value: value,
        currency: checkout.currencyCode,
      });
    }
  });

  // Payment Info Submitted
  analytics.subscribe("payment_info_submitted", (event) => {
    const checkout = event.data.checkout;
    const value = parseFloat(checkout.totalPrice.amount);

    if (metaPixelId) {
      (browser.window as any).fbq?.("track", "AddPaymentInfo", {
        content_ids: checkout.lineItems.map((item) => item.id),
        value,
        currency: checkout.currencyCode,
      });
    }
  });

  // Purchase Complete
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data.checkout;
    const value = parseFloat(checkout.totalPrice.amount);
    const transactionId = checkout.order?.id || checkout.token;

    // Google Analytics 4 Purchase
    if (googleMeasurementId) {
      (browser.window as any).gtag?.("event", "purchase", {
        transaction_id: transactionId,
        value,
        currency: checkout.currencyCode,
        tax: parseFloat(checkout.totalTax?.amount || "0"),
        shipping: parseFloat(checkout.shippingLine?.price?.amount || "0"),
        items: checkout.lineItems.map((item) => ({
          item_id: item.id,
          item_name: item.title,
          price: parseFloat(item.variant?.price?.amount || "0"),
          quantity: item.quantity,
        })),
      });

      // Google Ads Conversion
      if (googleConversionId && googleConversionLabel) {
        (browser.window as any).gtag?.("event", "conversion", {
          send_to: `${googleConversionId}/${googleConversionLabel}`,
          value,
          currency: checkout.currencyCode,
          transaction_id: transactionId,
        });
      }
    }

    // Meta Purchase
    if (metaPixelId) {
      (browser.window as any).fbq?.("track", "Purchase", {
        content_ids: checkout.lineItems.map((item) => item.id),
        contents: checkout.lineItems.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          item_price: parseFloat(item.variant?.price?.amount || "0"),
        })),
        content_type: "product",
        value,
        currency: checkout.currencyCode,
        order_id: transactionId,
        num_items: checkout.lineItems.reduce((sum, item) => sum + item.quantity, 0),
      });
    }

    // TikTok Complete Payment
    if (tiktokPixelId) {
      (browser.window as any).ttq?.track("CompletePayment", {
        contents: checkout.lineItems.map((item) => ({
          content_id: item.id,
          content_name: item.title,
          quantity: item.quantity,
          price: parseFloat(item.variant?.price?.amount || "0"),
        })),
        content_type: "product",
        value,
        currency: checkout.currencyCode,
        order_id: transactionId,
      });
    }

    // Microsoft Ads Purchase
    if (bingTagId) {
      (browser.window as any).uetq?.push("event", "purchase", {
        revenue_value: value,
        currency: checkout.currencyCode,
        transaction_id: transactionId,
      });
    }
  });
});

