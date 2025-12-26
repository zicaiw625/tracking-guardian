/**
 * Upgrade Module
 *
 * Handles Checkout Extensibility upgrade guidance:
 * - Deprecation date tracking
 * - Checkout profile status
 * - Migration urgency calculation
 * - Upgrade status messaging
 *
 * P2-1: Centralized upgrade guidance and timeline management.
 */

// Deprecation dates and timeline
export {
  DEPRECATION_DATES,
  DEADLINE_METADATA,
  getDateDisplayLabel,
  getScriptTagCreationStatus,
  getScriptTagExecutionStatus,
  getScriptTagDeprecationStatus,
  getAdditionalScriptsDeprecationStatus,
  getMigrationUrgencyStatus,
  getUpgradeStatusMessage,
  formatDeadlineForUI,
  type ShopTier,
  type DeprecationStatus,
  type ShopUpgradeStatus,
  type DateDisplayInfo,
  type DatePrecision,
} from "../../utils/deprecation-dates";

// Checkout profile management
export {
  getTypOspActive,
  refreshTypOspStatus,
  type CheckoutProfileInfo,
  type TypOspStatus,
  type TypOspUnknownReason,
  type TypOspStatusResult,
} from "../../services/checkout-profile.server";

// Shop tier detection
export {
  getShopPlan,
  refreshShopTier,
  refreshShopTierWithAdmin,
  getTierDisplayInfo,
  type ShopPlanInfo,
  type RefreshTierResult,
} from "../../services/shop-tier.server";

// Migration services
export {
  createWebPixel,
  updateWebPixel,
  getExistingWebPixels,
  isOurWebPixel,
  needsSettingsUpgrade,
  upgradeWebPixelSettings,
  buildWebPixelSettings,
  getScriptTagDeletionGuidance,
  getScriptTagMigrationGuidance,
} from "../../services/migration.server";

