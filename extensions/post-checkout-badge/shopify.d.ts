import '@shopify/ui-extensions';

// @ts-expect-error Shopify extension runtime injects global shopify API in this module.
declare module './src/thank-you.tsx' {
  const shopify: import('@shopify/ui-extensions/purchase.thank-you.customer-information.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}

// @ts-expect-error Shopify extension runtime injects global shopify API in this module.
declare module './src/order-status.tsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.order-status.customer-information.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}
