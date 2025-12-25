/**
 * Shopify Services Index
 *
 * Re-exports all Shopify-related services.
 */

// App configuration and main exports
export {
  default as shopify,
  apiVersion,
  addDocumentResponseHeaders,
  authenticate,
  unauthenticated,
  login,
  registerWebhooks,
  sessionStorage,
} from "./app-config.server";

// Re-export shopify as named export for convenience
export { default as shopifyApp } from "./app-config.server";

// Admin client factory
export {
  createAdminClientForShop,
  hasValidAdminClient,
} from "./admin-client.server";

// Shop provisioning
export {
  handleAfterAuth,
} from "./shop-provisioning.server";

// Webhook cleanup
export { cleanupDeprecatedWebhookSubscriptions } from "./webhook-cleanup.server";

