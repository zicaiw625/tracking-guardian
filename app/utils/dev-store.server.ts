

export function isDevStore(shopDomain: string): boolean {
  if (!shopDomain) return false;

  if (shopDomain.includes(".myshopify.dev")) {
    return true;
  }

  if (/-(dev|staging|test)\./i.test(shopDomain)) {
    return true;
  }

  return false;
}

export function generateModulePreviewUrl(
  shopDomain: string,
  moduleKey: string,
  target: "thank_you" | "order_status"
): string | null {
  if (!isDevStore(shopDomain)) {
    return null;
  }

  const baseUrl = `https://${shopDomain}`;

  if (target === "thank_you") {

    return `${baseUrl}/checkout/test`;
  }

  if (target === "order_status") {

    return `${baseUrl}/account/orders`;
  }

  return null;
}

