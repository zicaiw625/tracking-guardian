
import type { MigrationChecklist, MigrationChecklistItem } from "./migration-checklist.server";
import { logger } from "../utils/logger.server";

export async function generateMigrationChecklistPDF(
  checklist: MigrationChecklist,
  shopDomain: string
): Promise<Buffer> {
  try {

    const PDFDocument = (await import("pdfkit")).default;

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });

    doc.fontSize(20).font("Helvetica-Bold").text("迁移清单", { align: "center" });
    doc.moveDown(0.5);

    doc.fontSize(12).font("Helvetica").text(`店铺: ${shopDomain}`);
    doc.text(`生成时间: ${new Date(checklist.generatedAt).toLocaleString("zh-CN")}`);
    doc.text(`总项目数: ${checklist.totalItems}`);
    doc.text(`预计总时间: ${Math.round(checklist.estimatedTotalTime)} 分钟`);
    doc.moveDown();

    doc.fontSize(14).font("Helvetica-Bold").text("优先级统计");
    doc.fontSize(11).font("Helvetica");
    doc.text(`高风险项: ${checklist.highPriorityItems}`);
    doc.text(`中风险项: ${checklist.mediumPriorityItems}`);
    doc.text(`低风险项: ${checklist.lowPriorityItems}`);
    doc.moveDown();

    const itemsWithDeps = checklist.items.filter(item => {

      return false;
    });
    if (itemsWithDeps.length > 0) {
      doc.fontSize(12).font("Helvetica-Bold").text("依赖关系");
      doc.fontSize(10).font("Helvetica");
      doc.text("以下项目存在依赖关系，请按顺序迁移：");
      doc.moveDown(0.5);
    }

    doc.fontSize(16).font("Helvetica-Bold").text("迁移项目");
    doc.moveDown(0.5);

    checklist.items.forEach((item, index) => {

      if (doc.y > 700) {
        doc.addPage();
      }

      doc.fontSize(12).font("Helvetica-Bold");
      const fingerprint = item.fingerprint ? `(${item.fingerprint.substring(0, 8)}...)` : "";
      const itemTitle = `${index + 1}. ${item.title} ${fingerprint}`.trim();
      doc.text(itemTitle, { continued: false });

      const priorityColors: Record<string, string> = {
        high: "#FF0000",
        medium: "#FFA500",
        low: "#00AA00",
      };
      const priorityText = item.riskLevel === "high" ? "高" : item.riskLevel === "medium" ? "中" : "低";
      doc.fontSize(10).font("Helvetica");
      doc.fillColor(priorityColors[item.riskLevel] || "#000000");
      doc.text(` [${priorityText}优先级]`, { continued: true });
      doc.fillColor("#000000");

      doc.moveDown(0.3);

      doc.fontSize(10).font("Helvetica");
      doc.text(`风险等级 + 原因: ${getRiskLabel(item.riskLevel)} - ${item.riskReason}`);
      doc.text(`推荐迁移路径: ${getMigrationTypeName(item.suggestedMigration)}`);
      doc.text(`预估工时 + 需要的信息: ${formatEstimatedTime(item.estimatedTime)} | ${item.requiredInfo}`);

      doc.moveDown(0.5);

      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
    });

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).font("Helvetica").fillColor("#666666");
      doc.text(
        `第 ${i + 1} 页 / 共 ${totalPages} 页`,
        50,
        doc.page.height - 30,
        { align: "center", width: doc.page.width - 100 }
      );
      doc.fillColor("#000000");
    }

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cannot find module")) {
      logger.error("PDFKit not installed. Please run: pnpm add pdfkit @types/pdfkit");
      throw new Error("PDF 导出功能需要安装 pdfkit 依赖。请运行: pnpm add pdfkit @types/pdfkit");
    }
    logger.error("Failed to generate PDF", { error });
    throw error;
  }
}

function getMigrationTypeName(type: string): string {
  const names: Record<string, string> = {
    web_pixel: "Web Pixel",
    ui_extension: "UI Extension",
    server_side: "服务端 CAPI",
    none: "无需迁移",
  };
  return names[type] || type;
}

function getRiskLabel(riskLevel: MigrationChecklistItem["riskLevel"]): string {
  const labels: Record<MigrationChecklistItem["riskLevel"], string> = {
    high: "高风险",
    medium: "中风险",
    low: "低风险",
  };
  return labels[riskLevel];
}

function formatEstimatedTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
}

export async function generateEnhancedMigrationChecklistPDF(
  checklist: MigrationChecklist,
  shopDomain: string,
  dependencies?: Map<string, string[]>
): Promise<Buffer> {

  return generateMigrationChecklistPDF(checklist, shopDomain);
}
