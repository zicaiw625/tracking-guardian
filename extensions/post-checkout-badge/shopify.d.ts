import '@shopify/ui-extensions';

// @ts-expect-error Generated extension module typing placeholder for Shopify runtime globals
declare module './src/thank-you.tsx' {
  const shopify: import('@shopify/ui-extensions/purchase.thank-you.customer-information.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}

// @ts-expect-error Generated extension module typing placeholder for Shopify runtime globals
declare module './src/order-status.tsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.order-status.customer-information.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}
