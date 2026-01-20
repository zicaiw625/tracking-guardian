import prisma from "../db.server";
import { escapeCSV } from "../utils/csv.server";
import { validateRiskItemsArray, validateStringArray } from "../utils/scan-data-validation";

export async function generateScanReportCSV(reportId: string, shopId: string): Promise<string> {
  const scanReport = await prisma.scanReport.findFirst({
    where: {
      id: reportId,
      shopId: shopId,
    },
    select: {
      id: true,
      riskScore: true,
      riskItems: true,
      identifiedPlatforms: true,
      status: true,
      createdAt: true,
      completedAt: true,
    },
  });

  if (!scanReport) {
    throw new Error("Scan report not found");
  }

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true },
  });

  const riskItems = validateRiskItemsArray(scanReport.riskItems);
  const identifiedPlatforms = validateStringArray(scanReport.identifiedPlatforms);

  const lines: string[] = [];
  lines.push("扫描报告");
  lines.push(`店铺: ${escapeCSV(shop?.shopDomain || "未知")}`);
  lines.push(`报告ID: ${escapeCSV(scanReport.id)}`);
  lines.push(`生成时间: ${escapeCSV(scanReport.createdAt.toLocaleString("zh-CN"))}`);
  lines.push(`完成时间: ${escapeCSV(scanReport.completedAt ? scanReport.completedAt.toLocaleString("zh-CN") : "未完成")}`);
  lines.push(`状态: ${escapeCSV(scanReport.status)}`);
  lines.push(`风险评分: ${scanReport.riskScore ?? 0}/100`);
  lines.push(`检测到的平台: ${escapeCSV(identifiedPlatforms.join(", ") || "无")}`);
  lines.push(`风险项目数量: ${riskItems.length}`);
  lines.push("");

  lines.push("风险项目详情");
  lines.push("ID,名称,风险等级,平台,描述,建议");
  for (const item of riskItems) {
    const row = [
      escapeCSV(item.id || ""),
      escapeCSV(item.name || ""),
      escapeCSV(item.severity || ""),
      escapeCSV(item.platform || ""),
      escapeCSV(item.description || ""),
      escapeCSV(item.recommendation || ""),
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}
