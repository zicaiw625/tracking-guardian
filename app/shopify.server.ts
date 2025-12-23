/**
 * Shopify Server Module
 *
 * Re-exports from the modular Shopify services.
 * This file maintains backwards compatibility with existing imports.
 */

// Re-export all from the modular services
export {
  shopify as default,
  apiVersion,
  addDocumentResponseHeaders,
  authenticate,
  unauthenticated,
  login,
  registerWebhooks,
  sessionStorage,
  createAdminClientForShop,
} from "./services/shopify";
