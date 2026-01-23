import { encryptJson, decryptJson } from "../utils/crypto.server";
import { logger } from "../utils/logger.server";
import type { AlertSettings } from "../types";

export async function encryptAlertSettings(settings: AlertSettings): Promise<string> {
  try {
    return encryptJson(settings);
  } catch (error) {
    logger.error("Failed to encrypt alert settings", { error });
    throw new Error("Failed to encrypt alert settings");
  }
}

export async function decryptAlertSettings(encrypted: string): Promise<AlertSettings> {
  try {
    return decryptJson<AlertSettings>(encrypted);
  } catch (error) {
    logger.error("Failed to decrypt alert settings", { error });
    throw new Error("Failed to decrypt alert settings");
  }
}

export function getMaskedAlertSettings(settings: AlertSettings): Partial<AlertSettings> {
  const masked: Partial<AlertSettings> = { ...settings };
  if ("apiKey" in masked && typeof masked.apiKey === "string") {
    masked.apiKey = "***";
  }
  if ("token" in masked && typeof masked.token === "string") {
    masked.token = "***";
  }
  if ("webhookUrl" in masked && typeof masked.webhookUrl === "string") {
    const url = masked.webhookUrl;
    if (url.length > 20) {
      masked.webhookUrl = `${url.substring(0, 10)}...${url.substring(url.length - 10)}` as string;
    }
  }
  return masked;
}
