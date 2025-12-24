/**
 * Shopify Server Module
 *
 * BACKWARDS COMPATIBILITY LAYER
 * =============================
 * 
 * This file provides backwards compatibility for existing imports.
 * New code should import directly from the modular services:
 * 
 * RECOMMENDED:
 *   import { authenticate, apiVersion } from "~/services/shopify";
 * 
 * LEGACY (still works but not recommended):
 *   import { authenticate } from "~/shopify.server";
 * 
 * Benefits of importing from ~/services/shopify:
 * - Clearer module boundaries
 * - Better tree-shaking potential
 * - Consistent with other service imports
 * 
 * @see app/services/shopify/index.ts for the canonical implementation
 * @deprecated Prefer importing from "~/services/shopify" directly
 */

// Re-export all from the modular services for backwards compatibility
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
