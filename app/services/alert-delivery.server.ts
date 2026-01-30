import { logger } from "../utils/logger.server";
import { PLATFORM_ENDPOINTS } from "../utils/config.shared";
import prisma from "../db.server";

export interface AlertPayload {
  alertType: string;
  severity: string;
  message: string;
  payload: Record<string, unknown>;
  sentAt: Date;
}

export interface AlertConfigItem {
  channel: string;
  enabled: boolean;
  settings?: Record<string, unknown> | null;
  webhookUrl?: string;
  botToken?: string;
  chatId?: string;
  email?: string;
}

function buildAlertText(shopDomain: string | null, alert: AlertPayload): string {
  const lines = [
    `[Tracking Guardian] ${alert.alertType}`,
    `严重程度: ${alert.severity}`,
    alert.message,
  ];
  if (shopDomain) {
    lines.push(`店铺: ${shopDomain}`);
  }
  if (Object.keys(alert.payload).length > 0) {
    lines.push(`数据: ${JSON.stringify(alert.payload)}`);
  }
  return lines.join("\n");
}

async function sendSlack(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack ${res.status}: ${await res.text()}`);
  }
}

async function sendTelegram(botToken: string, chatId: string, text: string): Promise<void> {
  const url = PLATFORM_ENDPOINTS.TELEGRAM_BOT(botToken);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json().catch(() => ({})) as { ok?: boolean };
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram ${res.status}: ${JSON.stringify(data)}`);
  }
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  if (!apiKey || !from) {
    logger.warn("[AlertDelivery] Email skipped: RESEND_API_KEY or ALERT_EMAIL_FROM not set");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

export async function sendAlertToChannels(
  shopId: string,
  alert: AlertPayload,
  configs: AlertConfigItem[]
): Promise<void> {
  const enabled = configs.filter((c) => c.enabled !== false);
  if (enabled.length === 0) return;
  let shopDomain: string | null = null;
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true },
    });
    shopDomain = shop?.shopDomain ?? null;
  } catch {
    // no-op
  }
  const text = buildAlertText(shopDomain, alert);
  const subject = `[Tracking Guardian] ${alert.alertType}: ${alert.message.slice(0, 50)}`;
  for (const config of enabled) {
    try {
      if (config.channel === "slack") {
        const webhookUrl = config.webhookUrl ?? (config.settings?.webhookUrl as string | undefined);
        if (webhookUrl && typeof webhookUrl === "string") {
          await sendSlack(webhookUrl, text);
        }
      } else if (config.channel === "telegram") {
        const botToken = config.botToken ?? (config.settings?.botToken as string | undefined);
        const chatId = config.chatId ?? (config.settings?.chatId as string | undefined);
        if (botToken && chatId && typeof botToken === "string" && typeof chatId === "string") {
          await sendTelegram(botToken, chatId, text);
        }
      } else if (config.channel === "email") {
        const email = config.email ?? (config.settings?.email as string | undefined);
        if (email && typeof email === "string") {
          await sendEmail(email, subject, text);
        }
      }
    } catch (error) {
      logger.error("[AlertDelivery] Channel send failed", {
        shopId,
        channel: config.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
