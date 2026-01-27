export const PIXEL_EVENT_NAMES = [
  "checkout_completed",
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "page_viewed",
  "product_viewed",
  "product_added_to_cart",
] as const;

export type PixelEventName = typeof PIXEL_EVENT_NAMES[number];

export const PRIMARY_EVENTS = ["checkout_completed"] as const;

export const FUNNEL_EVENTS = [
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "page_viewed",
  "product_viewed",
  "product_added_to_cart",
] as const;
