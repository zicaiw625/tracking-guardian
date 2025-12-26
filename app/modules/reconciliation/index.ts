/**
 * Reconciliation Module
 *
 * Handles data reconciliation and health monitoring:
 * - Receipt vs webhook matching
 * - Missing event detection
 * - Delivery health checks
 * - Consent reconciliation
 *
 * P2-1: Centralized reconciliation and monitoring.
 */

// Reconciliation service
export {
  type ReconciliationResult,
  type ReconciliationSummary,
} from "../../services/reconciliation.server";

// Delivery health
export {
  runAllShopsDeliveryHealthCheck,
  type DeliveryHealthResult,
  type DeliveryHealthSummary,
  type DeliveryHealthReport,
} from "../../services/delivery-health.server";

// Consent reconciliation
export {
  reconcilePendingConsent,
} from "../../services/consent-reconciler.server";

// Receipt trust utilities
export {
  verifyReceiptTrust,
  isSendAllowedByTrust,
  buildTrustMetadata,
  buildShopAllowedDomains,
  type TrustLevel,
  type UntrustedReason,
  type ReceiptTrustResult,
  type VerifyReceiptOptions,
} from "../../utils/receipt-trust";

