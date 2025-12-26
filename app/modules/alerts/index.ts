/**
 * Alerts Module
 *
 * Handles notification delivery across multiple channels:
 * - Email notifications (via Resend)
 * - Slack webhooks
 * - Telegram bot messages
 *
 * P2-1: Unified notification interface with channel abstraction.
 */

// Re-export from existing services (gradual migration)
export {
  sendAlert,
  testNotification,
} from "../../services/notification.server";

export {
  encryptAlertSettings,
  decryptAlertSettings,
  getMaskedAlertSettings,
} from "../../services/alert-settings.server";

// Alert schemas
export {
  AlertEmailSchema,
  AlertSlackSchema,
  AlertTelegramSchema,
  AlertChannelSchema,
  AlertConfigSchema,
  validateAlertSettings,
  type AlertChannel,
  type AlertConfig,
} from "../../schemas/settings";

// Types from main types module
export type {
  AlertData,
  AlertSettings,
  EmailAlertSettings,
  SlackAlertSettings,
  TelegramAlertSettings,
} from "../../types";

