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
  hasExpiredPreviousSecret: boolean;
  graceWindowExpiry: Date | null;
  hasPendingRotation: boolean;
  pendingSecretExpiry: Date | null;
  pendingSecretMatchCount: number;
  consentStrategy: string;
  dataRetentionDays: number;
}

export interface TokenIssues {
  hasIssues: boolean;
  affectedPlatforms: string[];
}

export interface TypOspStatusDisplay {
  typOspPagesEnabled: boolean | null;
  status: "enabled" | "disabled" | "unknown";
  unknownReason?: string | null;
}

export interface SettingsLoaderData {
  shop: ShopSettingsData | null;
  tokenIssues: TokenIssues;
  pcdApproved?: boolean;
  pcdStatusMessage?: string;
  typOspStatus?: TypOspStatusDisplay | null;
  pixelStrictOrigin?: boolean;
  alertChannelsEnabled?: boolean;
  currentMonitoringData?: {
    failureRate: number;
    volumeDrop: number;
  } | null;
  hmacSecurityStats?: {
    lastRotationAt: Date | null;
    rotationCount: number;
    graceWindowActive: boolean;
    graceWindowExpiry: Date | null;
    suspiciousActivityCount: number;
    lastSuspiciousActivity: Date | null;
    nullOriginRequestCount: number;
    invalidSignatureCount: number;
    lastInvalidSignature: Date | null;
  } | null;
  capabilityFlags?: {
    pcdApproved: boolean;
    serverSideConversionsEnabled: boolean;
  };
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
