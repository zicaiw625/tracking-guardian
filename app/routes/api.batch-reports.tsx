

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  batchExportVerificationReports,
  batchExportScanReports,
  type BatchReportExportOptions,
} from "../services/batch-report-export.server";
import { getShopGroupDetails } from "../services/multi-shop.server";
import { canManageMultipleShops } from "../services/multi-shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const canManage = await canManageMultipleShops(shop.id);
  if (!canManage) {
    return json(
      { error: "当前套餐不支持批量导出，请升级到 Agency 版" },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "export_batch") {
    const reportType = (formData.get("reportType") as "verification" | "scan") || "verification";
    const format = (formData.get("format") as "csv" | "json" | "pdf") || "pdf";
    const groupId = formData.get("groupId") as string;

    if (!groupId) {
      return json({ error: "请选择店铺分组" }, { status: 400 });
    }

    const group = await getShopGroupDetails(groupId, shop.id);
    if (!group) {
      return json({ error: "分组不存在" }, { status: 404 });
    }

    const shopIds = group.members.map((m) => m.shopId);

    const options: BatchReportExportOptions = {
      shopIds,
      reportType,
      format,
    };

    let result;
    if (reportType === "verification") {
      result = await batchExportVerificationReports(options);
    } else {
      result = await batchExportScanReports(options);
    }

    if (result.combinedReport) {
      return new Response(result.combinedReport.content, {
        headers: {
          "Content-Type": result.combinedReport.mimeType,
          "Content-Disposition": `attachment; filename="${result.combinedReport.filename}"`,
        },
      });
    }

    return json({
      success: result.success,
      result,
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

