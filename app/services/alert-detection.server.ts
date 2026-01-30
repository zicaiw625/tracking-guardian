import { randomUUID } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { sendAlertToChannels } from "./alert-delivery.server";
import type { AlertConfigItem } from "./alert-delivery.server";

const SUCCESS_RATE_THRESHOLD = 0.7;
const MISSING_PARAMS_RATE_THRESHOLD = 0.5;
const VOLUME_DROP_RATIO_THRESHOLD = 0.5;

function dateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

function hashPayload(payload: Record<string, unknown>): string {
  const str = JSON.stringify(payload);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    h = (h << 5) - h + char;
    h = h & h;
  }
  return String(Math.abs(h));
}

export async function runAlertDetection(shopId: string, forDate?: Date): Promise<{
  created: number;
  createdAlerts: Array<{ alertType: string; severity: string; message: string; payload: Record<string, unknown>; sentAt: Date }>;
}> {
  const date = forDate ?? (() => {
    const y = new Date();
    y.setUTCDate(y.getUTCDate() - 1);
    y.setUTCHours(0, 0, 0, 0);
    return y;
  })();
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const key = dateKey(startOfDay);
  let created = 0;
  const createdAlerts: Array<{ alertType: string; severity: string; message: string; payload: Record<string, unknown>; sentAt: Date }> = [];

  const metrics = await prisma.dailyAggregatedMetrics.findUnique({
    where: { shopId_date: { shopId, date: startOfDay } },
  });

  if (!metrics) {
    return { created, createdAlerts };
  }

  const prevDate = new Date(startOfDay);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const prev = await prisma.dailyAggregatedMetrics.findUnique({
    where: { shopId_date: { shopId, date: prevDate } },
  });

  const alerts: Array<{ alertType: string; severity: string; message: string; payload: Record<string, unknown> }> = [];

  if (metrics.successRate < SUCCESS_RATE_THRESHOLD && metrics.totalOrders > 0) {
    alerts.push({
      alertType: "success_rate_low",
      severity: "warning",
      message: `事件成功率过低：${(metrics.successRate * 100).toFixed(1)}%（阈值 ${SUCCESS_RATE_THRESHOLD * 100}%）`,
      payload: { date: key, successRate: metrics.successRate, totalOrders: metrics.totalOrders },
    });
  }

  if (metrics.missingParamsRate >= MISSING_PARAMS_RATE_THRESHOLD && metrics.totalOrders > 0) {
    alerts.push({
      alertType: "missing_params_high",
      severity: "warning",
      message: `缺失参数率过高：${(metrics.missingParamsRate * 100).toFixed(1)}%`,
      payload: { date: key, missingParamsRate: metrics.missingParamsRate },
    });
  }

  if (prev && prev.eventVolume > 0 && metrics.eventVolume < prev.eventVolume * VOLUME_DROP_RATIO_THRESHOLD) {
    alerts.push({
      alertType: "event_volume_drop",
      severity: "critical",
      message: `事件量环比骤降：${metrics.eventVolume} vs 前日 ${prev.eventVolume}`,
      payload: { date: key, eventVolume: metrics.eventVolume, previousVolume: prev.eventVolume },
    });
  }

  const sentAt = startOfDay;
  for (const a of alerts) {
    const fingerprint = `${a.alertType}:${key}`;
    const payloadHash = hashPayload(a.payload);
    const existing = await prisma.alertEvent.findUnique({
      where: { shopId_fingerprint_sentAt: { shopId, fingerprint, sentAt } },
    });
    if (existing) continue;
    await prisma.alertEvent.create({
      data: {
        id: randomUUID(),
        shopId,
        alertType: a.alertType,
        severity: a.severity,
        fingerprint,
        message: a.message,
        channel: "app",
        payloadHash,
        sentAt,
      },
    });
    created++;
    createdAlerts.push({ ...a, sentAt });
  }

  return { created, createdAlerts };
}

function toAlertConfigItems(raw: unknown): AlertConfigItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: unknown) => {
    const item = c && typeof c === "object" ? c as Record<string, unknown> : {};
    const settings = item.settings && typeof item.settings === "object" ? item.settings as Record<string, unknown> : null;
    return {
      channel: typeof item.channel === "string" ? item.channel : "email",
      enabled: typeof item.isEnabled === "boolean" ? item.isEnabled : true,
      settings,
      webhookUrl: typeof item.webhookUrl === "string" ? item.webhookUrl : (settings?.webhookUrl as string | undefined),
      botToken: typeof item.botToken === "string" ? item.botToken : (settings?.botToken as string | undefined),
      chatId: typeof item.chatId === "string" ? item.chatId : (settings?.chatId as string | undefined),
      email: typeof item.email === "string" ? item.email : (settings?.email as string | undefined),
    };
  });
}

export async function runAlertDetectionForAllShops(): Promise<{ shopsProcessed: number; alertsCreated: number }> {
  const shops = await prisma.shop.findMany({
    where: { isActive: true },
    select: { id: true, settings: true },
  });
  let alertsCreated = 0;
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  for (const shop of shops) {
    try {
      const settings = shop.settings && typeof shop.settings === "object" ? shop.settings as Record<string, unknown> : null;
      const rawAlertConfigs = settings?.alertConfigs && Array.isArray(settings.alertConfigs) ? settings.alertConfigs : [];
      const runForShop = rawAlertConfigs.length > 0 || true;
      if (!runForShop) continue;
      const result = await runAlertDetection(shop.id, yesterday);
      alertsCreated += result.created;
      const alertConfigItems = toAlertConfigItems(rawAlertConfigs);
      for (const createdAlert of result.createdAlerts) {
        await sendAlertToChannels(shop.id, {
          alertType: createdAlert.alertType,
          severity: createdAlert.severity,
          message: createdAlert.message,
          payload: createdAlert.payload,
          sentAt: createdAlert.sentAt,
        }, alertConfigItems);
      }
    } catch (error) {
      logger.error("Alert detection failed for shop", error instanceof Error ? error : new Error(String(error)), { shopId: shop.id });
    }
  }
  return { shopsProcessed: shops.length, alertsCreated };
}
