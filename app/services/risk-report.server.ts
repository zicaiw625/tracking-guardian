import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { AuditAsset } from "@prisma/client";

export interface RiskReportItem {
  id: string;
  displayName: string;
  category: string;
  platform?: string;
  riskLevel: "high" | "medium" | "low";
  riskCategory: "will_fail" | "can_replace" | "no_migration_needed";
  suggestedMigration: "web_pixel" | "ui_extension" | "server_side" | "none";
  priority: number;
  estimatedTimeMinutes: number;
  description: string;
  migrationSteps: string[];
}

export interface EnhancedRiskReport {
  shopId: string;
  shopDomain: string;
  generatedAt: Date;
  overallRiskScore: number;
  summary: {
    totalItems: number;
    willFailCount: number;
    canReplaceCount: number;
    noMigrationNeededCount: number;
    highRiskCount: number;
    mediumRiskCount: number;
    lowRiskCount: number;
    totalEstimatedTime: number;
  };
  items: RiskReportItem[];
  categories: {
    willFail: RiskReportItem[];
    canReplace: RiskReportItem[];
    noMigrationNeeded: RiskReportItem[];
  };
}

function determineRiskCategory(
  asset: AuditAsset,
  riskLevel: "high" | "medium" | "low"
): "will_fail" | "can_replace" | "no_migration_needed" {

  if (riskLevel === "high") {
    return "will_fail";
  }

  if (asset.details && typeof asset.details === "object") {
    const details = asset.details as Record<string, unknown>;
    const displayScope = details.display_scope as string | undefined;
    if (displayScope === "order_status") {
      return "will_fail";
    }
  }

  if (riskLevel === "medium") {
    return "can_replace";
  }

  if (riskLevel === "low" || asset.suggestedMigration === "none") {
    return "no_migration_needed";
  }

  if (asset.category === "analytics") {
    return "no_migration_needed";
  }

  return "can_replace";
}

function generateMigrationSteps(
  asset: AuditAsset,
  suggestedMigration: string
): string[] {
  const steps: string[] = [];

  switch (suggestedMigration) {
    case "web_pixel":
      steps.push("1. 在迁移页面配置 Web Pixel");
      steps.push("2. 选择对应的平台（" + (asset.platform || "未知平台") + "）");
      steps.push("3. 填写平台凭证（如需要）");
      steps.push("4. 在 Test 环境测试");
      steps.push("5. 验证事件正常触发后切换到 Live");
      break;
    case "ui_extension":
      steps.push("1. 在 UI 模块页面选择对应的模块");
      steps.push("2. 配置模块参数和显示规则");
      steps.push("3. 预览效果");
      steps.push("4. 发布到生产环境");
      break;
    case "server_side":
      steps.push("1. 在设置页面配置服务端 API 凭证");
      steps.push("2. 启用服务端追踪");
      steps.push("3. 验证服务端事件正常发送");
      break;
    case "none":
      steps.push("无需迁移，可保留现有配置");
      break;
  }

  return steps;
}

export async function generateEnhancedRiskReport(
  shopId: string
): Promise<EnhancedRiskReport | null> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, shopDomain: true },
    });

    if (!shop) {
      return null;
    }

    const latestScan = await prisma.scanReport.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      select: { riskScore: true },
    });

    const assets = await prisma.auditAsset.findMany({
      where: { shopId },
      orderBy: [
        { priority: "desc" },
        { riskLevel: "desc" },
        { createdAt: "desc" },
      ],
    });

    const items: RiskReportItem[] = assets.map((asset) => {
      const riskLevel = asset.riskLevel as "high" | "medium" | "low";
      const riskCategory = determineRiskCategory(asset, riskLevel);
      const suggestedMigration = asset.suggestedMigration as
        | "web_pixel"
        | "ui_extension"
        | "server_side"
        | "none";

      return {
        id: asset.id,
        displayName: asset.displayName || `${asset.category} - ${asset.platform || "未知"}`,
        category: asset.category,
        platform: asset.platform || undefined,
        riskLevel,
        riskCategory,
        suggestedMigration,
        priority: asset.priority || 5,
        estimatedTimeMinutes: asset.estimatedTimeMinutes || 30,
        description: getMigrationDescription(asset),
        migrationSteps: generateMigrationSteps(asset, suggestedMigration),
      };
    });

    const categories = {
      willFail: items.filter((item) => item.riskCategory === "will_fail"),
      canReplace: items.filter((item) => item.riskCategory === "can_replace"),
      noMigrationNeeded: items.filter(
        (item) => item.riskCategory === "no_migration_needed"
      ),
    };

    const summary = {
      totalItems: items.length,
      willFailCount: categories.willFail.length,
      canReplaceCount: categories.canReplace.length,
      noMigrationNeededCount: categories.noMigrationNeeded.length,
      highRiskCount: items.filter((i) => i.riskLevel === "high").length,
      mediumRiskCount: items.filter((i) => i.riskLevel === "medium").length,
      lowRiskCount: items.filter((i) => i.riskLevel === "low").length,
      totalEstimatedTime: items.reduce(
        (sum, item) => sum + item.estimatedTimeMinutes,
        0
      ),
    };

    return {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      generatedAt: new Date(),
      overallRiskScore: latestScan?.riskScore || 0,
      summary,
      items,
      categories,
    };
  } catch (error) {
    logger.error("Failed to generate enhanced risk report", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function getMigrationDescription(asset: AuditAsset): string {
  const categoryNames: Record<string, string> = {
    pixel: "追踪像素",
    affiliate: "联盟追踪",
    survey: "售后问卷",
    support: "客服入口",
    analytics: "站内分析",
    other: "其他",
  };

  const migrationNames: Record<string, string> = {
    web_pixel: "迁移到 Web Pixel",
    ui_extension: "迁移到 UI Extension",
    server_side: "迁移到服务端 CAPI",
    none: "无需迁移",
  };

  const categoryName = categoryNames[asset.category] || "其他";
  const migrationName = migrationNames[asset.suggestedMigration] || "未知";

  if (asset.platform) {
    const platformNames: Record<string, string> = {
      google: "Google Analytics",
      meta: "Meta (Facebook)",
      tiktok: "TikTok",
      pinterest: "Pinterest",
      snapchat: "Snapchat",
    };
    const platformName = platformNames[asset.platform] || asset.platform;
    return `${categoryName} (${platformName}) - ${migrationName}`;
  }

  return `${categoryName} - ${migrationName}`;
}

export function generateRiskReportCSV(report: EnhancedRiskReport): string {
  const lines: string[] = [];

  const escapeCSV = (value: string | number | undefined): string => {
    if (value === undefined || value === null) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  lines.push("风险报告");
  lines.push(`店铺: ${escapeCSV(report.shopDomain)}`);
  lines.push(`生成时间: ${escapeCSV(report.generatedAt.toLocaleString("zh-CN"))}`);
  lines.push(`总体风险分数: ${escapeCSV(report.overallRiskScore)}`);
  lines.push("");

  lines.push("摘要");
  lines.push(`总项目数,${report.summary.totalItems}`);
  lines.push(`会失效/受限,${report.summary.willFailCount}`);
  lines.push(`可直接替换,${report.summary.canReplaceCount}`);
  lines.push(`无需迁移,${report.summary.noMigrationNeededCount}`);
  lines.push(`高风险项,${report.summary.highRiskCount}`);
  lines.push(`中风险项,${report.summary.mediumRiskCount}`);
  lines.push(`低风险项,${report.summary.lowRiskCount}`);
  lines.push(`预计总时间(分钟),${report.summary.totalEstimatedTime}`);
  lines.push("");

  lines.push("详细项目");
  const headers = [
    "ID",
    "显示名称",
    "类别",
    "平台",
    "风险等级",
    "风险分类",
    "建议迁移方式",
    "优先级(1-10)",
    "预计时间(分钟)",
    "描述",
    "迁移步骤",
  ];
  lines.push(headers.map(escapeCSV).join(","));

  for (const item of report.items) {
    const row = [
      escapeCSV(item.id),
      escapeCSV(item.displayName),
      escapeCSV(item.category),
      escapeCSV(item.platform || ""),
      escapeCSV(item.riskLevel),
      escapeCSV(item.riskCategory),
      escapeCSV(item.suggestedMigration),
      escapeCSV(item.priority),
      escapeCSV(item.estimatedTimeMinutes),
      escapeCSV(item.description),
      escapeCSV(item.migrationSteps.join("; ")),
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

export async function generateRiskReportPDF(
  shopId: string
): Promise<{ data: EnhancedRiskReport; format: "json" }> {
  const report = await generateEnhancedRiskReport(shopId);
  if (!report) {
    throw new Error("Failed to generate risk report");
  }
  return { data: report, format: "json" };
}

