import { encryptJson, decryptJson } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";

export { encryptJson };

export function encryptAlertSettings(channel: string, settings: Record<string, unknown>): string | null {
    const sensitiveSettings: Record<string, unknown> = {};
    if (channel === "slack" && settings.webhookUrl) {
        sensitiveSettings.webhookUrl = settings.webhookUrl;
    }
    else if (channel === "telegram" && settings.botToken) {
        sensitiveSettings.botToken = settings.botToken;
        sensitiveSettings.chatId = settings.chatId;
    }
    else if (channel === "email") {
        sensitiveSettings.email = settings.email;
    }
    if (Object.keys(sensitiveSettings).length === 0) {
        return null;
    }
    return encryptJson(sensitiveSettings);
}

export function decryptAlertSettings(encryptedSettings: string | null): Record<string, unknown> | null {
    if (!encryptedSettings) {
        return null;
    }
    try {
        return decryptJson<Record<string, unknown>>(encryptedSettings);
    }
    catch (error) {
        logger.warn("[P0-2] Failed to decrypt alert settings", { error: String(error) });
        return null;
    }
}

export function getMaskedAlertSettings(channel: string, settings: Record<string, unknown> | null): Record<string, unknown> {
    if (!settings) {
        return {};
    }
    const masked = { ...settings };
    if (channel === "slack" && masked.webhookUrl) {
        const url = String(masked.webhookUrl);
        masked.webhookUrl = url.length > 12 ? `****${url.slice(-8)}` : "****";
    }
    if (channel === "telegram" && masked.botToken) {
        const token = String(masked.botToken);
        masked.botToken = token.length > 12 ? `${token.slice(0, 8)}****` : "****";
    }
    return masked;
}

