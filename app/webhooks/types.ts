

import type { Shop, PixelConfig } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface WebhookContext {

  shop: string;

  topic: string;

  webhookId: string | null;

  payload: unknown;

  admin: AdminApiContext | null;

  session: unknown;
}

export interface ShopWithPixelConfigs extends Shop {
  pixelConfigs: PixelConfig[];
}

export interface WebhookHandlerResult {
  success: boolean;
  status: number;
  message: string;

  orderId?: string;
}

export type WebhookHandler = (
  context: WebhookContext,
  shopRecord: ShopWithPixelConfigs | null
) => Promise<WebhookHandlerResult>;

export interface WebhookLockResult {
  acquired: boolean;
  existing?: boolean;
}

export type GDPRJobType = "data_request" | "customer_redact" | "shop_redact";

