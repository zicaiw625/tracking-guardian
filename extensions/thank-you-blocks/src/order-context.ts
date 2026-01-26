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
  return result;
}
