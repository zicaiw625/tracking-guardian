// Settings page types

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

export type AlertSettings = AlertSettingsEmail | AlertSettingsSlack | AlertSettingsTelegram;

export interface AlertConfigDisplay {
    id: string;
    channel: string;
    settings: Record<string, unknown> | null;
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
    lastTestedAt?: Date | null;
}

export interface ShopSettings {
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

