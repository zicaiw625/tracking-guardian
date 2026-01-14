export interface OrderContext {
  checkoutToken: string | null;
  orderId: string | null;
}

interface CheckoutApi {
  checkout?: {
    token?: string;
  };
  order?: {
    id?: string;
  };
}

interface CustomerAccountOrderApi {
  order?: {
    id?: string;
  };
}

function hasProperty<K extends string>(
  obj: unknown,
  prop: K
): obj is Record<K, unknown> {
  return typeof obj === "object" && obj !== null && prop in obj;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCheckoutApi(api: unknown): api is CheckoutApi {
  if (!hasProperty(api, "checkout") && !hasProperty(api, "order")) {
    return false;
  }
  if (hasProperty(api, "checkout")) {
    const checkout = api.checkout;
    if (typeof checkout !== "object" || checkout === null) {
      return false;
    }
    if (hasProperty(checkout, "token") && typeof checkout.token !== "string") {
      return false;
    }
  }
  if (hasProperty(api, "order")) {
    const order = api.order;
    if (typeof order !== "object" || order === null) {
      return false;
    }
    if (hasProperty(order, "id") && typeof order.id !== "string") {
      return false;
    }
  }
  return true;
}

function isCustomerAccountOrderApi(api: unknown): api is CustomerAccountOrderApi {
  if (!hasProperty(api, "order")) {
    return false;
  }
  const order = api.order;
  if (typeof order !== "object" || order === null) {
    return false;
  }
  if (hasProperty(order, "id") && typeof order.id !== "string") {
    return false;
  }
  return true;
}

export function getOrderContext(api: unknown): OrderContext {
  const result: OrderContext = {
    checkoutToken: null,
    orderId: null,
  };
  if (isCheckoutApi(api)) {
    if (hasProperty(api, "checkout")) {
      const checkout = api.checkout;
      if (typeof checkout === "object" && checkout !== null && hasProperty(checkout, "token")) {
        const token = checkout.token;
        if (isString(token)) {
          result.checkoutToken = token;
        }
      }
    }
    if (hasProperty(api, "order")) {
      const order = api.order;
      if (typeof order === "object" && order !== null && hasProperty(order, "id")) {
        const id = order.id;
        if (isString(id)) {
          result.orderId = id;
        }
      }
    }
  }
  if (isCustomerAccountOrderApi(api)) {
    if (hasProperty(api, "order")) {
      const order = api.order;
      if (typeof order === "object" && order !== null && hasProperty(order, "id")) {
        const id = order.id;
        if (isString(id)) {
          result.orderId = id;
        }
      }
    }
  }
  return result;
}
