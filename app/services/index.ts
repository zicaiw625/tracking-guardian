/**
 * Services Index
 *
 * Centralized exports for all service modules.
 * Import from this file for cleaner imports throughout the app.
 */

// =============================================================================
// Shopify Services
// =============================================================================

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
} from "./shopify";

// =============================================================================
// Database Repositories
// =============================================================================

export * from "./db";

// =============================================================================
// Platform Services
// =============================================================================

export * from "./platforms";

// =============================================================================
// Core Services
// =============================================================================

// Billing
export * from "./billing";

// Alert Settings
export {
  encryptAlertSettings,
  decryptAlertSettings,
  getMaskedAlertSettings,
} from "./alert-settings.server";

// Encryption (from utils for convenience)
export { encryptJson, decryptJson } from "../utils/crypto.server";

// Notification
export { sendAlert, testNotification } from "./notification.server";

// Migration
export {
  getExistingWebPixels,
  updateWebPixel,
} from "./migration.server";

// Retry
export {
  checkTokenExpirationIssues,
} from "./retry.server";

// Conversion Job
export {
  processConversionJobs,
} from "./conversion-job.server";

// Audit (re-export from db for convenience)
export { createAuditLog } from "./audit.server";
