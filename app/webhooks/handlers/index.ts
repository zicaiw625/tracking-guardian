/**
 * Webhook Handlers Index
 *
 * Re-exports all webhook handlers.
 */

export { handleOrdersPaid } from "./orders-paid.handler";
export { handleAppUninstalled } from "./app-uninstalled.handler";
export {
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleShopRedact,
} from "./gdpr.handler";

