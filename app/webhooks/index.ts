/**
 * Webhooks Module
 *
 * Centralized webhook handling with modular handlers.
 */

// Types
export type {
  WebhookContext,
  WebhookHandlerResult,
  WebhookLockResult,
  ShopWithPixelConfigs,
  WebhookHandler,
  GDPRJobType,
} from "./types";

// Dispatcher
export { dispatchWebhook } from "./dispatcher";

// Handlers
export {
  handleOrdersPaid,
  handleAppUninstalled,
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
} from "./handlers";

// Middleware
export {
  tryAcquireWebhookLock,
  updateWebhookStatus,
  withIdempotency,
} from "./middleware";

