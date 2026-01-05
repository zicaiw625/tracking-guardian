

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
  settings?: Record<string, unknown> | null;
  frequency?: string;
  discrepancyThreshold: number;
  isEnabled: boolean;
}

export interface PixelConfigDisplay {
  id: string;
  platform: string;
  platformId: string | null;
  serverSideEnabled: boolean;
  clientSideEnabled: boolean;
  isActive: boolean;
  environment?: "test" | "live";
  configVersion?: number;
  rollbackAllowed?: boolean;
  lastTestedAt?: Date | null;
}

export interface ShopSettingsData {
  id: string;
  domain: string;
  plan: string;
  alertConfigs: AlertConfigDisplay[];
  pixelConfigs: PixelConfigDisplay[];
  hasIngestionSecret: boolean;
  hasActiveGraceWindow: boolean;
  graceWindowExpiry: Date | null;
  // P0-2: v1.0 版本不包含任何 PCD/PII 处理，因此移除 piiEnabled 和 pcdAcknowledged
  weakConsentMode: boolean;
  consentStrategy: string;
  dataRetentionDays: number;
}

export interface TokenIssues {
  hasIssues: boolean;
  affectedPlatforms: string[];
}

export interface SettingsLoaderData {
  shop: ShopSettingsData | null;
  tokenIssues: TokenIssues;
  // P0-2: v1.0 版本不包含任何 PCD/PII 处理，因此移除 pcdApproved 和 pcdStatusMessage
  currentMonitoringData?: {
    failureRate: number;
    missingParamsRate: number;
    volumeDrop: number;
  } | null;
}

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
