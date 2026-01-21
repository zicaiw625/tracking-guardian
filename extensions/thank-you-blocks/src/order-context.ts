import { PCD_ORDER_UNAVAILABLE_USER } from "./pcd-copy";

export interface OrderContext {
  checkoutToken: string | null;
  orderId: string | null;
}

export interface CheckoutOrderContextParams {
  checkoutToken: string | null;
  orderConfirmation: { order?: { id?: string } } | null;
}

export interface CustomerAccountOrderContextParams {
  order: { id?: string } | null;
  checkoutToken: string | null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function getOrderContextFromCheckout(params: CheckoutOrderContextParams): OrderContext {
  const result: OrderContext = {
    checkoutToken: params.checkoutToken ?? null,
    orderId: null,
  };
  if (params.orderConfirmation?.order?.id) {
    const orderId = params.orderConfirmation.order.id;
    if (isString(orderId)) {
      result.orderId = orderId;
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

export function getOrderContextFromCustomerAccount(params: CustomerAccountOrderContextParams): OrderContext {
  const result: OrderContext = {
    checkoutToken: params.checkoutToken ?? null,
    orderId: null,
  };
  if (params.order?.id) {
    const orderId = params.order.id;
    if (isString(orderId)) {
      result.orderId = orderId;
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
