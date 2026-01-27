import type { AlertData, AlertConfig } from "../types";
import { logger } from "../utils/logger.server";

interface AlertConfigWithEncryption extends AlertConfig {
    settingsEncrypted?: string | null;
}

export async function sendAlert(config: AlertConfigWithEncryption, data: AlertData): Promise<boolean> {
    logger.info("Alert event logged (external notifications disabled in v1)", {
        alertConfigId: config.id,
        channel: config.channel,
        shopDomain: data.shopDomain,
        platform: data.platform,
        orderDiscrepancy: data.orderDiscrepancy,
    });
    return true;
}

export async function testNotification(channel: string, _settings: unknown): Promise<{
    success: boolean;
    message: string;
}> {
    logger.info("Test notification requested (external notifications disabled in v1)", {
        channel,
    });
    return {
        success: false,
        message: "外部通知功能在 v1 版本中已禁用，仅支持应用内告警",
    };
}
