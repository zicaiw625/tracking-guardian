

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

export * from "./db";

export * from "./platforms";

export * from "./billing";

export {
  encryptAlertSettings,
  decryptAlertSettings,
  getMaskedAlertSettings,
} from "./alert-settings.server";

export { encryptJson, decryptJson } from "../utils/crypto.server";

export { sendAlert, testNotification } from "./notification.server";

export {
  getExistingWebPixels,
  updateWebPixel,
} from "./migration.server";

export {
  checkTokenExpirationIssues,
} from "./retry.server";

export {
  processConversionJobs,
} from "./conversion-job.server";

// Alert dispatcher
export {
  runAlertChecks,
  runAllShopAlertChecks,
  checkFailureRate,
  checkMissingParams,
  checkVolumeDrop,
  checkDedupConflicts,
  checkPixelHeartbeat,
  getAlertHistory,
  acknowledgeAlert,
} from "./alert-dispatcher.server";

// Enhanced reconciliation
export {
  runReconciliation,
  fetchShopifyOrders,
  reconcilePixelVsCapi,
  saveReconciliationReport,
} from "./enhanced-reconciliation.server";

// Batch pixel template
export {
  createPixelTemplate,
  getPixelTemplates,
  getPixelTemplate,
  updatePixelTemplate,
  deletePixelTemplate,
  batchApplyPixelTemplate,
  applyPresetTemplate,
  PRESET_TEMPLATES,
} from "./batch-pixel-apply.server";

// CAPI Dedup
export {
  generateEventId,
  generateTimestampedEventId,
  checkShouldSend,
  markEventSent,
  markEventFailed,
  analyzeDedupConflicts,
  cleanupExpiredNonces,
  formatMetaEventId,
  formatGA4TransactionId,
  formatTikTokEventId,
  formatPinterestEventId,
  formatSnapchatDedupId,
} from "./capi-dedup.server";

