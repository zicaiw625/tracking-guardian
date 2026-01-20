import { PCD_ORDER_UNAVAILABLE_USER } from "./pcd-copy";

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
  if (!result.orderId && !result.checkoutToken) {
    const errorMessage = `订单信息不可用（Order ID 和 checkout token 均为空）。${PCD_ORDER_UNAVAILABLE_USER}`;
    const criticalMessage = "严重：订单信息完全不可用。这会导致以下功能无法正常工作：1) 问卷提交无法关联订单；2) 再购功能无法获取订单详情；3) 帮助中心无法提供订单相关支持。请确保应用已通过 PCD 审核，或联系技术支持。";
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[Tracking Guardian] ⚠️ ${errorMessage}错误已自动上报，商家会收到通知。`);
    }
    if (typeof console !== "undefined" && console.error) {
      console.error(`[Tracking Guardian] ❌ ${criticalMessage}错误已自动上报，商家会收到通知。`);
    }
  }
  return result;
}
