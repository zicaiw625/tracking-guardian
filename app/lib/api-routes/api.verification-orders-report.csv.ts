import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { authenticate } from "../../shopify.server";
import { performPixelVsOrderReconciliation } from "../../services/verification/order-reconciliation.server";
import { escapeCSV } from "../../utils/csv.server";
import { sanitizeFilename } from "../../utils/responses";
import { withSecurityHeaders } from "../../utils/security-headers";
import { PCD_CONFIG } from "../../utils/config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    if (!PCD_CONFIG.APPROVED) {
      return new Response("Order reconciliation is not enabled; PCD approval required.", { status: 403 });
    }
    const url = new URL(request.url);
    const hoursParam = url.searchParams.get("hours");
    const hours = Math.min(
      168,
      Math.max(1, hoursParam ? parseInt(hoursParam, 10) || 24 : 24)
    );

    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, shopDomain: true },
    });

    if (!shop) {
      return new Response("Shop not found", { status: 404 });
    }

    const reconciliation = await performPixelVsOrderReconciliation(
      shop.id,
      hours
    );

    const csvLines: string[] = [];
    csvLines.push("订单层验收对账报告");
    csvLines.push(`店铺: ${shop.shopDomain}`);
    csvLines.push(`时间窗: ${hours} 小时`);
    csvLines.push(`统计区间: ${reconciliation.periodStart.toISOString()} 至 ${reconciliation.periodEnd.toISOString()}`);
    csvLines.push(`总订单数,${reconciliation.totalOrders}`);
    csvLines.push(`有像素订单数,${reconciliation.ordersWithPixel}`);
    csvLines.push(`差异率,${reconciliation.discrepancyRate}%`);
    csvLines.push("");
    csvLines.push("有订单无像素（丢单）");
    csvLines.push("订单ID,金额,币种");
    for (const r of reconciliation.missingOrderIds) {
      csvLines.push(
        [r.orderId, String(r.totalPrice), r.currency].map(escapeCSV).join(",")
      );
    }
    csvLines.push("");
    csvLines.push("金额/币种不一致");
    csvLines.push("订单ID,订单金额,订单币种,像素金额,像素币种");
    for (const r of reconciliation.valueMismatches) {
      csvLines.push(
        [
          r.orderId,
          String(r.orderValue),
          r.orderCurrency,
          String(r.pixelValue),
          r.pixelCurrency,
        ]
          .map(escapeCSV)
          .join(",")
      );
    }

    const csvContent = csvLines.join("\n");
    const filename = `verification-orders-${shop.shopDomain.replace(/\./g, "_")}-${hours}h-${new Date().toISOString().split("T")[0]}.csv`;

    return new Response(csvContent, {
      headers: withSecurityHeaders({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
      }),
    });
  } catch (error) {
    logger.error("Failed to export verification orders CSV", {
      error,
      hours: new URL(request.url).searchParams.get("hours"),
    });
    return new Response(
      error instanceof Error ? error.message : "Failed to export verification orders CSV",
      { status: 500 }
    );
  }
};
