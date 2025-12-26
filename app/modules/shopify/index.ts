/**
 * Shopify Module
 *
 * Handles all Shopify-related functionality:
 * - Admin API client creation and management
 * - Shop provisioning and lifecycle
 * - Webhook management
 * - App configuration
 *
 * P2-1: Centralized Shopify integration layer.
 */

// Re-export from shopify services index
export {
  shopify,
  shopifyApp,
  apiVersion,
  addDocumentResponseHeaders,
  authenticate,
  unauthenticated,
  login,
  registerWebhooks,
  sessionStorage,
  createAdminClientForShop,
  hasValidAdminClient,
  handleAfterAuth,
  cleanupDeprecatedWebhookSubscriptions,
} from "../../services/shopify";

// Additional admin client exports
export {
  executeGraphQL,
} from "../../services/shopify/admin-client.server";

// Re-export shop access utilities
export {
  getShopWithDecryptedFields,
  getShopByIdWithDecryptedFields,
  getDecryptedIngestionSecret,
  getShopForVerification,
  getShopForVerificationWithConfigs,
  verifyWithGraceWindow,
  timingSafeEquals,
  type DecryptedShop,
  type ShopWithDecryptedSecret,
  type ShopVerificationData,
  type ShopWithPixelConfigs,
} from "../../utils/shop-access";

// Re-export JWT utilities
export {
  verifyShopifyJwt,
  extractAuthToken,
  getShopifyApiSecret,
} from "../../utils/shopify-jwt";

