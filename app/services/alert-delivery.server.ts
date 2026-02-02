import { logger } from "../utils/logger.server";
import { PLATFORM_ENDPOINTS } from "../utils/config.shared";
import prisma from "../db.server";
import { postJson } from "../utils/http";

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

function validateSlackWebhookUrl(raw: string): { ok: boolean; reason?: string } {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return { ok: false, reason: "Slack webhook must be https" };
    if (u.hostname !== "hooks.slack.com") return { ok: false, reason: "Slack host must be hooks.slack.com" };
    if (!u.pathname.startsWith("/services/") && !u.pathname.startsWith("/triggers/")) {
      return { ok: false, reason: "Slack webhook path must start with /services/ or /triggers/" };
    }
    if (u.username || u.password) return { ok: false, reason: "Credentials not allowed in URL" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "Invalid URL format" };
  }
}

async function sendSlack(webhookUrl: string, text: string): Promise<void> {
  const res = await postJson(webhookUrl, { text });
  if (!res.ok) {
    throw new Error(`Slack ${res.status}: ${JSON.stringify(res.data)}`);
  }
}

async function sendTelegram(botToken: string, chatId: string, text: string): Promise<void> {
  const url = PLATFORM_ENDPOINTS.TELEGRAM_BOT(botToken);
  const res = await postJson(url, { chat_id: chatId, text });
  const data = res.data as { ok?: boolean };
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
  const res = await postJson("https://api.resend.com/emails", {
    from,
    to: [to],
    subject,
    text,
  }, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${JSON.stringify(res.data)}`);
  }
}

const ALERT_CHANNELS_ENABLED = ["true", "1", "yes"].includes(
  (process.env.ALERT_CHANNELS_ENABLED ?? "").toLowerCase().trim()
);

function isValidUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s: string): boolean {
  return EMAIL_REGEX.test(s.trim());
}

export async function sendAlertToChannels(
  shopId: string,
  alert: AlertPayload,
  configs: AlertConfigItem[]
): Promise<void> {
  if (!ALERT_CHANNELS_ENABLED) return;
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
        const validation = webhookUrl ? validateSlackWebhookUrl(webhookUrl) : { ok: false, reason: "Missing webhookUrl" };
        if (!webhookUrl || typeof webhookUrl !== "string" || !webhookUrl.trim() || !validation.ok) {
          logger.warn(`[AlertDelivery] Slack config invalid: ${validation.reason || "missing or invalid webhookUrl"}`, { shopId });
          continue;
        }
        await sendSlack(webhookUrl.trim(), text);
      } else if (config.channel === "telegram") {
        const botToken = config.botToken ?? (config.settings?.botToken as string | undefined);
        const chatId = config.chatId ?? (config.settings?.chatId as string | undefined);
        if (!botToken || !chatId || typeof botToken !== "string" || typeof chatId !== "string" || !botToken.trim() || !chatId.trim()) {
          logger.warn("[AlertDelivery] Telegram config invalid: missing botToken or chatId", { shopId });
          continue;
        }
        await sendTelegram(botToken.trim(), chatId.trim(), text);
      } else if (config.channel === "email") {
        const email = config.email ?? (config.settings?.email as string | undefined);
        if (!email || typeof email !== "string" || !email.trim() || !isValidEmail(email)) {
          logger.warn("[AlertDelivery] Email config invalid: missing or invalid email", { shopId });
          continue;
        }
        await sendEmail(email.trim(), subject, text);
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
