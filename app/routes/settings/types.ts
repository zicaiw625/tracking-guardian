/**
 * Settings Route Types
 *
 * Shared types for settings routes and components.
 */

// =============================================================================
// Alert Settings Types
// =============================================================================

export interface AlertSettingsEmail {
  email: string;
}

export interface AlertSettingsSlack {
  webhookUrl: string;
}

export interface AlertSettingsTelegram {
  botToken: string;
  chatId: string;
}

export type AlertSettings =
  | AlertSettingsEmail
  | AlertSettingsSlack
  | AlertSettingsTelegram;

export interface AlertConfigDisplay {
  id: string;
  channel: string;
  // P0-1: 'settings' field removed from display interface
  // Sensitive webhook URLs and tokens are not exposed to frontend
  discrepancyThreshold: number;
  isEnabled: boolean;
}

// =============================================================================
// Pixel Config Types
// =============================================================================

export interface PixelConfigDisplay {
  id: string;
  platform: string;
  platformId: string | null;
  serverSideEnabled: boolean;
  clientSideEnabled: boolean;
  isActive: boolean;
  lastTestedAt?: Date | null;
}

// =============================================================================
// Shop Data Types
// =============================================================================

export interface ShopSettingsData {
  id: string;
  domain: string;
  plan: string;
  alertConfigs: AlertConfigDisplay[];
  pixelConfigs: PixelConfigDisplay[];
  hasIngestionSecret: boolean;
  hasActiveGraceWindow: boolean;
  graceWindowExpiry: Date | null;
  piiEnabled: boolean;
  pcdAcknowledged: boolean;
  weakConsentMode: boolean;
  consentStrategy: string;
  dataRetentionDays: number;
}

export interface TokenIssues {
  hasIssues: boolean;
  affectedPlatforms: string[];
}

// =============================================================================
// Loader Data Types
// =============================================================================

export interface SettingsLoaderData {
  shop: ShopSettingsData | null;
  tokenIssues: TokenIssues;
  pcdApproved: boolean;
  pcdStatusMessage: string;
}

// =============================================================================
// Action Response Types
// =============================================================================

export interface ActionSuccessResponse {
  success: true;
  message: string;
  pixelSyncSuccess?: boolean;
  graceWindowExpiry?: string;
}

export interface ActionErrorResponse {
  success: false;
  error?: string;
  message?: string;
  requirePcdAcknowledgement?: boolean;
}

export type SettingsActionResponse = ActionSuccessResponse | ActionErrorResponse;
