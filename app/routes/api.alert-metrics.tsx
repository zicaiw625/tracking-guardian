import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats } from "../services/monitoring.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const hours = parseInt(url.searchParams.get("hours") || "24", 10);

  try {
    const [monitoringStats, missingParamsStats, volumeStats] = await Promise.all([
      getEventMonitoringStats(shop.id, hours).catch(() => null),
      getMissingParamsStats(shop.id, hours).catch(() => null),
      getEventVolumeStats(shop.id).catch(() => null),
    ]);

    const missingParamsRate = monitoringStats && missingParamsStats && monitoringStats.totalEvents > 0
      ? (missingParamsStats.reduce((sum, s) => sum + s.count, 0) / monitoringStats.totalEvents) * 100
      : undefined;

    return json({
      monitoringStats: monitoringStats ? {
        failureRate: monitoringStats.failureRate,
        successRate: monitoringStats.successRate,
        totalEvents: monitoringStats.totalEvents,
      } : null,
      missingParamsRate,
      volumeStats: volumeStats ? {
        isDrop: volumeStats.isDrop,
        changePercent: volumeStats.changePercent,
        current24h: volumeStats.current24h,
        previous24h: volumeStats.previous24h,
      } : null,
    });
  } catch (error) {
    return json({ error: "Failed to fetch metrics" }, { status: 500 });
  }
};
