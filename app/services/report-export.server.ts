
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { VerificationSummary } from "./verification.server";

export interface ExportOptions {
  format: "csv" | "json" | "pdf";
  includeEvents?: boolean;
  includeSummary?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
  whiteLabel?: {
    companyName?: string;
    logoUrl?: string;
    contactEmail?: string;
    contactPhone?: string;
  };
}

export async function exportVerificationReport(
  runId: string,
  options: ExportOptions
): Promise<string> {
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    include: {
      Shop: {
        select: {
          shopDomain: true,
        },
      },
    },
  });

  if (!run) {
    throw new Error("Verification run not found");
  }

  const summary = run.summaryJson as VerificationSummary | null;
  const events = (run.eventsJson as Array<{
    testItemId?: string;
    eventType?: string;
    platform?: string;
    orderId?: string;
    status?: string;
    params?: {
      value?: number;
      currency?: string;
      items?: number;
    };
    discrepancies?: string[];
    errors?: string[];
  }>) || [];

  switch (options.format) {
    case "csv":
      return exportToCSV(run, summary, events, options);
    case "json":
      return exportToJSON(run, summary, events, options);
    case "pdf":
      return exportToPDF(run, summary, events, options);
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}

function exportToCSV(
  run: {
    Shop: { shopDomain: string };
    runName: string;
    startedAt: Date | null;
    status: string;
  },
  summary: VerificationSummary | null,
  events: Array<{
    testItemId?: string;
    eventType?: string;
    platform?: string;
    orderId?: string;
    status?: string;
    params?: {
      value?: number;
      currency?: string;
      items?: number;
    };
    discrepancies?: string[];
    errors?: string[];
  }>,
  options: ExportOptions
): string {
  const lines: string[] = [];

  lines.push("验收报告");
  lines.push(`店铺: ${run.Shop.shopDomain}`);
  lines.push(`运行名称: ${run.runName}`);
  lines.push(`运行时间: ${run.startedAt ? new Date(run.startedAt).toLocaleString("zh-CN") : "N/A"}`);
  lines.push(`状态: ${run.status}`);
  lines.push("");

    if (summary && options.includeSummary) {
      lines.push("摘要");
      lines.push(`总测试数: ${summary.totalTests}`);
      lines.push(`通过测试: ${summary.passedTests}`);
      lines.push(`失败测试: ${summary.failedTests}`);
      lines.push(`参数完整率: ${summary.parameterCompleteness}%`);
      lines.push(`金额准确率: ${summary.valueAccuracy}%`);
      lines.push("");

      if (summary.platformResults) {
        lines.push("按平台统计");
        Object.entries(summary.platformResults).forEach(([platform, stats]) => {
          lines.push(`  ${platform}: 成功 ${stats.sent || 0}, 失败 ${stats.failed || 0}`);
        });
        lines.push("");
      }

      if (summary.results && summary.results.length > 0) {
        const eventTypeStats = new Map<string, { success: number; failed: number }>();
        summary.results.forEach((result) => {
          const stats = eventTypeStats.get(result.eventType) || { success: 0, failed: 0 };
          if (result.status === "success") {
            stats.success++;
          } else {
            stats.failed++;
          }
          eventTypeStats.set(result.eventType, stats);
        });

        if (eventTypeStats.size > 0) {
          lines.push("按事件类型统计");
          eventTypeStats.forEach((stats, eventType) => {
            lines.push(`  ${eventType}: 成功 ${stats.success}, 失败 ${stats.failed}`);
          });
          lines.push("");
        }
      }
    }

  if (options.includeEvents && events.length > 0) {
    lines.push("事件详情");
    lines.push("事件类型,平台,订单ID,状态,金额,币种,错误信息");
    events.forEach((event) => {
      const row = [
        event.eventType || "",
        event.platform || "",
        event.orderId || "",
        event.status || "",
        event.params?.value || "",
        event.params?.currency || "",
        event.errors?.join("; ") || "",
      ];
      lines.push(row.map((cell) => `"${cell}"`).join(","));
    });
  }

  return lines.join("\n");
}

function exportToJSON(
  run: {
    id: string;
    Shop: { shopDomain: string };
    runName: string;
    runType: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    platforms: string[];
  },
  summary: VerificationSummary | null,
  events: Array<{
    testItemId?: string;
    eventType?: string;
    platform?: string;
    orderId?: string;
    status?: string;
    params?: {
      value?: number;
      currency?: string;
      items?: number;
    };
    discrepancies?: string[];
    errors?: string[];
  }>,
  options: ExportOptions
): string {
  const data = {
    report: {
      id: run.id,
      shopDomain: run.Shop.shopDomain,
      runName: run.runName,
      runType: run.runType,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      platforms: run.platforms,
    },
    summary: options.includeSummary ? summary : undefined,
    events: options.includeEvents ? events : undefined,
  };

  return JSON.stringify(data, null, 2);
}

async function exportToPDF(
  run: {
    id: string;
    Shop: { shopDomain: string };
    runName: string;
    runType: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    platforms: string[];
  },
  summary: VerificationSummary | null,
  events: Array<{
    testItemId?: string;
    eventType?: string;
    platform?: string;
    orderId?: string;
    status?: string;
    params?: {
      value?: number;
      currency?: string;
      items?: number;
    };
    discrepancies?: string[];
    errors?: string[];
  }>,
  options: ExportOptions
): Promise<string> {

  try {
    // Dynamic import for pdfkit
    // Note: Using any type here because pdfkit's type definitions are incomplete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let PDFDocument: any;
    try {
      const pdfkitModule = await import("pdfkit");
      PDFDocument = pdfkitModule.default || pdfkitModule;
    } catch {
      logger.warn("PDFKit not installed, falling back to JSON export");
      return exportToJSON(run, summary, events, options);
    }

    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => {});

    const companyName = options.whiteLabel?.companyName || "Tracking Guardian";
    const logoUrl = options.whiteLabel?.logoUrl;

    doc.fontSize(20).text("验收报告", { align: "center" });
    if (logoUrl) {

      doc.fontSize(12).text(companyName, { align: "center" });
    }
    doc.moveDown();

    doc.fontSize(12);
    doc.text(`店铺: ${run.Shop.shopDomain}`);
    doc.text(`运行名称: ${run.runName}`);
    doc.text(`运行时间: ${run.startedAt ? new Date(run.startedAt).toLocaleString("zh-CN") : "N/A"}`);
    doc.text(`状态: ${run.status}`);
    doc.moveDown();

    if (summary && options.includeSummary) {
      doc.fontSize(16).text("摘要", { underline: true });
      doc.fontSize(12);
      doc.text(`总测试数: ${summary.totalTests}`);
      doc.text(`通过测试: ${summary.passedTests}`);
      doc.text(`失败测试: ${summary.failedTests}`);
      if (summary.parameterCompleteness !== undefined) {
        doc.text(`参数完整率: ${summary.parameterCompleteness}%`);
      }
      if (summary.valueAccuracy !== undefined) {
        doc.text(`金额准确率: ${summary.valueAccuracy}%`);
      }
      doc.moveDown();

      if (summary.platformResults && Object.keys(summary.platformResults).length > 0) {
        doc.fontSize(14).text("按平台统计", { underline: true });
        doc.fontSize(12);
        Object.entries(summary.platformResults).forEach(([platform, stats]: [string, { sent?: number; failed?: number }]) => {
          doc.text(`  ${platform}: 成功 ${stats.sent || 0}, 失败 ${stats.failed || 0}`);
        });
        doc.moveDown();
      }

      if (summary.results && summary.results.length > 0) {
        const eventTypeStats = new Map<string, { success: number; failed: number }>();
        summary.results.forEach((result: {
          eventType: string;
          status: string;
        }) => {
          const stats = eventTypeStats.get(result.eventType) || { success: 0, failed: 0 };
          if (result.status === "success") {
            stats.success++;
          } else {
            stats.failed++;
          }
          eventTypeStats.set(result.eventType, stats);
        });

        if (eventTypeStats.size > 0) {
          doc.fontSize(14).text("按事件类型统计", { underline: true });
          doc.fontSize(12);
          eventTypeStats.forEach((stats, eventType) => {
            doc.text(`  ${eventType}: 成功 ${stats.success}, 失败 ${stats.failed}`);
          });
          doc.moveDown();
        }
      }
    }

    if (options.includeEvents && events.length > 0) {
      doc.fontSize(16).text("事件详情", { underline: true });
      doc.moveDown(0.5);

      events.forEach((event, index) => {
        if (index > 0) doc.moveDown(0.5);
        doc.fontSize(10);
        doc.text(`事件 ${index + 1}:`, { continued: true }).font("Helvetica-Bold");
        doc.text(` ${event.eventType || "N/A"}`, { font: "Helvetica" });
        doc.text(`  平台: ${event.platform || "N/A"}`);
        doc.text(`  订单ID: ${event.orderId || "N/A"}`);
        doc.text(`  状态: ${event.status || "N/A"}`);
        if (event.params) {
          doc.text(`  金额: ${event.params.value || "N/A"} ${event.params.currency || ""}`);
        }
        if (event.errors && event.errors.length > 0) {
          doc.text(`  错误: ${event.errors.join("; ")}`, { color: "red" });
        }
      });
    }

    doc.moveDown(2);
    doc.fontSize(10).text("—", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`本报告由 ${companyName} 自动生成`, { align: "center" });
    if (options.whiteLabel?.contactEmail) {
      doc.fontSize(10).text(`联系方式: ${options.whiteLabel.contactEmail}`, { align: "center" });
    }
    if (options.whiteLabel?.contactPhone) {
      doc.fontSize(10).text(`电话: ${options.whiteLabel.contactPhone}`, { align: "center" });
    }
    doc.fontSize(10).text(`生成时间: ${new Date().toLocaleString("zh-CN")}`, { align: "center" });

    doc.end();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("PDF generation timeout"));
      }, 30000);

      doc.on("end", () => {
        clearTimeout(timeout);
        const pdfBuffer = Buffer.concat(chunks);
        const base64 = pdfBuffer.toString("base64");
        resolve(base64);
      });

      doc.on("error", (error: Error) => {
        clearTimeout(timeout);
        logger.error("PDF generation error", error);
        reject(error);
      });
    });
  } catch (error) {
    logger.error("PDF export failed", error);

    return exportToJSON(run, summary, events, options);
  }
}

export async function exportMigrationChecklist(
  shopId: string,
  options: ExportOptions
): Promise<string> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  const assets = await prisma.auditAsset.findMany({
    where: {
      shopId,
      migrationStatus: { in: ["pending", "in_progress"] },
    },
    orderBy: [
      { priority: "desc" },
      { riskLevel: "desc" },
    ],
  });

  switch (options.format) {
    case "csv":
      return exportChecklistToCSV(shop.shopDomain, assets);
    case "json":
      return exportChecklistToJSON(shop.shopDomain, assets);
    case "pdf":
      return exportChecklistToPDF(shop.shopDomain, assets);
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}

async function exportChecklistToPDF(shopDomain: string, assets: Array<Record<string, unknown>>): Promise<string> {
  try {
    // Dynamic import for pdfkit
    // Note: Using any type here because pdfkit's type definitions are incomplete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let PDFDocument: any;
    try {
      const pdfkitModule = await import("pdfkit");
      PDFDocument = pdfkitModule.default || pdfkitModule;
    } catch {
      logger.warn("PDFKit not installed, falling back to JSON export");
      return exportChecklistToJSON(shopDomain, assets);
    }

    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const companyName = "Tracking Guardian";
    const logoUrl = undefined;

    doc.fontSize(20).text("迁移清单", { align: "center" });
    if (logoUrl) {
      doc.fontSize(12).text(companyName, { align: "center" });
    }
    doc.moveDown();

    doc.fontSize(12);
    doc.text(`店铺: ${shopDomain}`);
    doc.text(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
    doc.text(`待迁移项: ${assets.length}`);
    doc.moveDown();

    doc.fontSize(16).text("迁移项列表", { underline: true });
    doc.moveDown(0.5);

    assets.forEach((asset, index) => {
      if (index > 0) doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`${index + 1}. ${asset.displayName || asset.category}`, { font: "Helvetica-Bold" });
      doc.text(`   优先级: ${asset.priority || "N/A"} | 风险等级: ${asset.riskLevel || "N/A"}`);
      doc.text(`   平台: ${asset.platform || "N/A"} | 分类: ${asset.category || "N/A"}`);
      doc.text(`   建议迁移方式: ${asset.suggestedMigration || "N/A"}`);
      doc.text(`   预计时间: ${asset.estimatedTimeMinutes || "N/A"} 分钟`);
      doc.text(`   状态: ${asset.migrationStatus || "pending"}`);
    });

    doc.moveDown(2);
    doc.fontSize(10).text("—", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`本报告由 ${companyName} 自动生成`, { align: "center" });
    doc.fontSize(10).text(`生成时间: ${new Date().toLocaleString("zh-CN")}`, { align: "center" });

    doc.end();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("PDF generation timeout"));
      }, 30000);

      doc.on("end", () => {
        clearTimeout(timeout);
        const pdfBuffer = Buffer.concat(chunks);
        const base64 = pdfBuffer.toString("base64");
        resolve(base64);
      });

      doc.on("error", (error: Error) => {
        clearTimeout(timeout);
        logger.error("PDF generation error", error);
        reject(error);
      });
    });
  } catch (error) {
    logger.error("PDF export failed", error);
    return exportChecklistToJSON(shopDomain, assets);
  }
}

function exportChecklistToCSV(shopDomain: string, assets: Array<Record<string, unknown>>): string {
  const lines: string[] = [];

  lines.push("迁移清单");
  lines.push(`店铺: ${shopDomain}`);
  lines.push(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push(`待迁移项: ${assets.length}`);
  lines.push("");
  lines.push("优先级,风险等级,资产名称,平台,分类,建议迁移方式,预计时间(分钟),状态");

  assets.forEach((asset) => {
    const row = [
      asset.priority || "",
      asset.riskLevel || "",
      asset.displayName || "",
      asset.platform || "",
      asset.category || "",
      asset.suggestedMigration || "",
      asset.estimatedTimeMinutes || "",
      asset.migrationStatus || "",
    ];
    lines.push(row.map((cell) => `"${cell}"`).join(","));
  });

  return lines.join("\n");
}

function exportChecklistToJSON(shopDomain: string, assets: Array<Record<string, unknown>>): string {
  const data = {
    shopDomain,
    generatedAt: new Date().toISOString(),
    totalItems: assets.length,
    items: assets.map((asset) => ({
      id: asset.id,
      displayName: asset.displayName,
      platform: asset.platform,
      category: asset.category,
      riskLevel: asset.riskLevel,
      priority: asset.priority,
      suggestedMigration: asset.suggestedMigration,
      estimatedTimeMinutes: asset.estimatedTimeMinutes,
      migrationStatus: asset.migrationStatus,
    })),
  };

  return JSON.stringify(data, null, 2);
}

export async function exportMultiShopReport(
  shopIds: string[],
  options: ExportOptions & {
    workspaceName?: string;
    agencyBranding?: {
      name?: string;
      logo?: string;
    };
  }
): Promise<string> {
  const shops = await prisma.shop.findMany({
    where: { id: { in: shopIds } },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
    },
  });

  const shopMap = new Map(shops.map(s => [s.id, s]));

  const allAssets = await prisma.auditAsset.findMany({
    where: {
      shopId: { in: shopIds },
      migrationStatus: { in: ["pending", "in_progress"] },
    },
    orderBy: [
      { priority: "desc" },
      { riskLevel: "desc" },
    ],
  });

  const shopAssets = new Map<string, typeof allAssets>();
  allAssets.forEach(asset => {
    if (!shopAssets.has(asset.shopId)) {
      shopAssets.set(asset.shopId, []);
    }
    shopAssets.get(asset.shopId)!.push(asset);
  });

  switch (options.format) {
    case "csv":
      return exportMultiShopToCSV(shops, shopAssets, options);
    case "json":
      return exportMultiShopToJSON(shops, shopAssets, options);
    case "pdf":
      return exportMultiShopToPDF(shops, shopAssets, options);
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}

function exportMultiShopToCSV(
  shops: Array<{ id: string; shopDomain: string; plan: string }>,
  shopAssets: Map<string, Array<Record<string, unknown>>>,
  options: ExportOptions & { workspaceName?: string; agencyBranding?: { name?: string } }
): string {
  const lines: string[] = [];

  lines.push("多店铺迁移报告");
  if (options.workspaceName) {
    lines.push(`工作区: ${options.workspaceName}`);
  }
  if (options.agencyBranding?.name) {
    lines.push(`生成机构: ${options.agencyBranding.name}`);
  }
  lines.push(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push(`店铺数量: ${shops.length}`);
  lines.push("");

  shops.forEach(shop => {
    const assets = shopAssets.get(shop.id) || [];
    lines.push(`店铺: ${shop.shopDomain} (${shop.plan})`);
    lines.push(`待迁移项: ${assets.length}`);
    lines.push("优先级,风险等级,资产名称,平台,分类,建议迁移方式,预计时间(分钟),状态");

    assets.forEach((asset) => {
      const row = [
        asset.priority || "",
        asset.riskLevel || "",
        asset.displayName || "",
        asset.platform || "",
        asset.category || "",
        asset.suggestedMigration || "",
        asset.estimatedTimeMinutes || "",
        asset.migrationStatus || "",
      ];
      lines.push(row.map((cell) => `"${cell}"`).join(","));
    });
    lines.push("");
  });

  return lines.join("\n");
}

function exportMultiShopToJSON(
  shops: Array<{ id: string; shopDomain: string; plan: string }>,
  shopAssets: Map<string, Array<Record<string, unknown>>>,
  options: ExportOptions & { workspaceName?: string; agencyBranding?: { name?: string } }
): string {
  const data = {
    report: {
      workspaceName: options.workspaceName,
      agencyBranding: options.agencyBranding,
      generatedAt: new Date().toISOString(),
      totalShops: shops.length,
    },
    shops: shops.map(shop => ({
      id: shop.id,
      shopDomain: shop.shopDomain,
      plan: shop.plan,
      totalItems: (shopAssets.get(shop.id) || []).length,
      items: (shopAssets.get(shop.id) || []).map((asset) => ({
        id: asset.id,
        displayName: asset.displayName,
        platform: asset.platform,
        category: asset.category,
        riskLevel: asset.riskLevel,
        priority: asset.priority,
        suggestedMigration: asset.suggestedMigration,
        estimatedTimeMinutes: asset.estimatedTimeMinutes,
        migrationStatus: asset.migrationStatus,
      })),
    })),
  };

  return JSON.stringify(data, null, 2);
}

async function exportMultiShopToPDF(
  shops: Array<{ id: string; shopDomain: string; plan: string }>,
  shopAssets: Map<string, Array<Record<string, unknown>>>,
  options: ExportOptions & { workspaceName?: string; agencyBranding?: { name?: string; logo?: string } }
): Promise<string> {
  try {
    // Dynamic import for pdfkit
    // Note: Using any type here because pdfkit's type definitions are incomplete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let PDFDocument: any;
    try {
      const pdfkitModule = await import("pdfkit");
      PDFDocument = pdfkitModule.default || pdfkitModule;
    } catch {
      logger.warn("PDFKit not installed, falling back to JSON export");
      return exportMultiShopToJSON(shops, shopAssets, options);
    }

    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(20).text("多店铺迁移报告", { align: "center" });
    if (options.agencyBranding?.name) {
      doc.fontSize(12).text(`生成机构: ${options.agencyBranding.name}`, { align: "center" });
    }
    doc.moveDown();

    doc.fontSize(12);
    if (options.workspaceName) {
      doc.text(`工作区: ${options.workspaceName}`);
    }
    doc.text(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
    doc.text(`店铺数量: ${shops.length}`);
    doc.moveDown();

    shops.forEach((shop, shopIndex) => {
      if (shopIndex > 0) {
        doc.addPage();
      }

      const assets = shopAssets.get(shop.id) || [];

      doc.fontSize(16).text(`店铺 ${shopIndex + 1}: ${shop.shopDomain}`, { underline: true });
      doc.fontSize(12);
      doc.text(`套餐: ${shop.plan}`);
      doc.text(`待迁移项: ${assets.length}`);
      doc.moveDown(0.5);

      if (assets.length > 0) {
        doc.fontSize(14).text("迁移项列表", { underline: true });
        doc.moveDown(0.5);

        assets.forEach((asset, index) => {
          if (index > 0) doc.moveDown(0.3);
          doc.fontSize(10);
          doc.text(`${index + 1}. ${asset.displayName || asset.category}`, { font: "Helvetica-Bold" });
          doc.text(`   优先级: ${asset.priority || "N/A"} | 风险等级: ${asset.riskLevel || "N/A"}`);
          doc.text(`   平台: ${asset.platform || "N/A"} | 分类: ${asset.category || "N/A"}`);
          doc.text(`   建议迁移方式: ${asset.suggestedMigration || "N/A"}`);
          doc.text(`   预计时间: ${asset.estimatedTimeMinutes || "N/A"} 分钟`);
          doc.text(`   状态: ${asset.migrationStatus || "pending"}`);
        });
      } else {
        doc.text("暂无待迁移项", { color: "gray" });
      }
    });

    doc.end();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("PDF generation timeout"));
      }, 60000);

      doc.on("end", () => {
        clearTimeout(timeout);
        const pdfBuffer = Buffer.concat(chunks);
        const base64 = pdfBuffer.toString("base64");
        resolve(base64);
      });

      doc.on("error", (error: Error) => {
        clearTimeout(timeout);
        logger.error("PDF generation error", error);
        reject(error);
      });
    });
  } catch (error) {
    logger.error("Multi-shop PDF export failed", error);
    return exportMultiShopToJSON(shops, shopAssets, options);
  }
}

