import '@shopify/ui-extensions';

//@ts-expect-error - Implicit import from Shopify runtime environment
declare module './src/thank-you.tsx' {
  const shopify: import('@shopify/ui-extensions/purchase.thank-you.customer-information.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-expect-error - Implicit import from Shopify runtime environment
declare module './src/order-status.tsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.order-status.customer-information.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}
