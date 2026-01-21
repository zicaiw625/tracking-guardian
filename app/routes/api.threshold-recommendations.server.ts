import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getThresholdRecommendations, testThresholds } from "../services/alert-dispatcher.server";
import { getEventMonitoringStats, getMissingParamsStats } from "../services/monitoring.server";
import { jsonApi } from "../utils/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return jsonApi({ error: "Shop not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action === "recommendations") {
    const recommendations = await getThresholdRecommendations(shop.id);
    return jsonApi({ recommendations });
  }
  if (action === "test") {
    const failureRate = url.searchParams.get("failureRate");
    const missingParams = url.searchParams.get("missingParams");
    const volumeDrop = url.searchParams.get("volumeDrop");
    const testResult = await testThresholds(shop.id, {
      failureRate: failureRate ? parseFloat(failureRate) : undefined,
      missingParams: missingParams ? parseFloat(missingParams) : undefined,
      volumeDrop: volumeDrop ? parseFloat(volumeDrop) : undefined,
    });
    return jsonApi({ testResult });
  }
  if (action === "current") {
    const [monitoringStats, missingParamsStats] = await Promise.all([
      getEventMonitoringStats(shop.id, 24),
      getMissingParamsStats(shop.id, 24),
    ]);
    return jsonApi({
      current: {
        failureRate: monitoringStats.failureRate,
        missingParams: missingParamsStats.missingParamsRate,
      },
    });
  }
  return jsonApi({ error: "Invalid action" }, { status: 400 });
};
