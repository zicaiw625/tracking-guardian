import PDFDocument from "pdfkit";
import type { MigrationChecklist } from "./migration-checklist.server";

export async function generateChecklistPDF(
  checklist: MigrationChecklist,
  shopDomain: string,
  riskScore?: number | null
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const margin = 50;
      
      const addPageHeader = () => {
        doc.fontSize(10);
        doc.font("Helvetica");
        doc.text(shopDomain, margin, 30, { width: pageWidth - 2 * margin, align: "left" });
        doc.text("Tracking Guardian 迁移审计报告", margin, 30, { width: pageWidth - 2 * margin, align: "right" });
        doc.moveTo(margin, 45).lineTo(pageWidth - margin, 45).stroke();
      };
      
      const addPageFooter = () => {
        const pageNum = doc.bufferedPageRange().count;
        doc.fontSize(9);
        doc.font("Helvetica");
        const footerY = pageHeight - 30;
        doc.text(
          `生成时间: ${checklist.generatedAt.toLocaleString("zh-CN")}`,
          margin,
          footerY,
          { width: pageWidth - 2 * margin, align: "left" }
        );
        doc.text(
          `第 ${pageNum} 页`,
          margin,
          footerY,
          { width: pageWidth - 2 * margin, align: "right" }
        );
      };
      
      doc.on("pageAdded", () => {
        addPageHeader();
        addPageFooter();
      });
      
      addPageHeader();
      doc.y = 60;
      
      doc.fontSize(28).font("Helvetica-Bold");
      doc.text("Tracking Guardian", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(20);
      doc.text("迁移审计报告", { align: "center" });
      doc.moveDown(1);
      
      doc.fontSize(12).font("Helvetica");
      doc.text(`店铺域名: ${shopDomain}`, { align: "center" });
      doc.text(`报告版本: v1.0`, { align: "center" });
      doc.text(`生成日期: ${checklist.generatedAt.toLocaleString("zh-CN")}`, { align: "center" });
      doc.moveDown(1.5);
      
      doc.addPage();
      addPageHeader();
      doc.y = 60;
      
      doc.fontSize(18).font("Helvetica-Bold");
      doc.text("执行摘要", { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(12).font("Helvetica");
      if (riskScore !== null && riskScore !== undefined) {
        const riskLevel = riskScore >= 70 ? "高" : riskScore >= 40 ? "中" : "低";
        doc.text(`风险评分: ${riskScore} (${riskLevel}风险)`);
        doc.moveDown(0.3);
      }
      
      doc.text(`总项目数: ${checklist.totalItems}`);
      doc.text(`高优先级项目: ${checklist.highPriorityItems}`);
      doc.text(`中优先级项目: ${checklist.mediumPriorityItems}`);
      doc.text(`低优先级项目: ${checklist.lowPriorityItems}`);
      doc.text(`预计总工时: ${formatTime(checklist.estimatedTotalTime)}`);
      doc.moveDown(0.5);
      
      const completedCount = checklist.items.filter(i => i.status === "completed").length;
      const inProgressCount = checklist.items.filter(i => i.status === "in_progress").length;
      const pendingCount = checklist.items.filter(i => i.status === "pending").length;
      const skippedCount = checklist.items.filter(i => i.status === "skipped").length;
      
      doc.font("Helvetica-Bold").text("迁移状态概览:");
      doc.font("Helvetica");
      doc.text(`  已完成: ${completedCount}`);
      doc.text(`  进行中: ${inProgressCount}`);
      doc.text(`  待处理: ${pendingCount}`);
      doc.text(`  已跳过: ${skippedCount}`);
      doc.moveDown(0.5);
      
      const topRiskItems = checklist.items
        .filter(i => i.riskLevel === "high")
        .slice(0, 5);
      
      if (topRiskItems.length > 0) {
        doc.font("Helvetica-Bold").text("关键风险项摘要:");
        doc.font("Helvetica");
        topRiskItems.forEach((item, idx) => {
          doc.text(`  ${idx + 1}. ${truncate(item.title, 100)} (${item.platform || "未知平台"})`);
        });
      }
      
      doc.addPage();
      addPageHeader();
      doc.y = 60;
      
      doc.fontSize(18).font("Helvetica-Bold");
      doc.text("详细清单", { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(12);
      
      checklist.items.forEach((item, index) => {
        if (index > 0) {
          doc.moveDown(0.5);
        }
        
        if (doc.y > pageHeight - 100) {
          doc.addPage();
          addPageHeader();
          doc.y = 60;
        }
        
        const riskLevelText = item.riskLevel === "high" ? "高" : item.riskLevel === "medium" ? "中" : "低";
        const migrationText = 
          item.suggestedMigration === "web_pixel" ? "Web Pixel" :
          item.suggestedMigration === "ui_extension" ? "UI Extension Block" :
          item.suggestedMigration === "server_side" ? "Server-side CAPI" :
          "External redirect / not supported";
        
        doc.font("Helvetica-Bold").text(`${index + 1}. ${truncate(item.title, 200)}`, { continued: false });
        doc.font("Helvetica");
        doc.fontSize(10).text(`   类别: ${item.category}${item.platform ? ` | 平台: ${item.platform}` : ""}`);
        doc.text(`   风险等级: ${riskLevelText} - ${truncate(item.riskReason, 300)}`);
        doc.text(`   推荐迁移路径: ${migrationText}`);
        doc.text(`   预计工时: ${formatTime(item.estimatedTime)}`);
        doc.text(`   需要的信息: ${truncate(item.requiredInfo, 300)}`);
        doc.text(`   状态: ${getStatusText(item.status)}`);
        
        if (item.description) {
          doc.fontSize(9).text(`   描述: ${item.description}`, { 
            width: pageWidth - 2 * margin - 20,
            ellipsis: true 
          });
        }
      });
      
      doc.addPage();
      addPageHeader();
      doc.y = 60;
      
      doc.fontSize(18).font("Helvetica-Bold");
      doc.text("验收结论", { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(12).font("Helvetica");
      doc.text("迁移状态概览:");
      doc.moveDown(0.3);
      doc.text(`  已完成项目: ${completedCount} / ${checklist.totalItems}`);
      doc.text(`  进行中项目: ${inProgressCount}`);
      doc.text(`  待处理项目: ${pendingCount}`);
      doc.text(`  已跳过项目: ${skippedCount}`);
      doc.moveDown(0.5);
      
      const completionRate = checklist.totalItems > 0 
        ? ((completedCount / checklist.totalItems) * 100).toFixed(1)
        : "0";
      
      doc.font("Helvetica-Bold").text(`完成率: ${completionRate}%`);
      doc.font("Helvetica");
      doc.moveDown(0.5);
      
      doc.text("下一步建议:");
      doc.moveDown(0.3);
      if (pendingCount > 0) {
        doc.text(`  1. 优先处理 ${checklist.highPriorityItems} 个高优先级项目`);
      }
      if (inProgressCount > 0) {
        doc.text(`  2. 完成 ${inProgressCount} 个进行中的项目`);
      }
      if (checklist.highPriorityItems > 0) {
        doc.text(`  3. 关注高风险项，确保迁移质量`);
      }
      if (completedCount === checklist.totalItems && checklist.totalItems > 0) {
        doc.text(`  4. 所有项目已完成，建议进行验收测试`);
      }
      
      addPageFooter();
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function truncate(str: string, maxLen: number): string {
  const s = typeof str === "string" ? str : "";
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

function formatTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
}

function getStatusText(status: string): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "in_progress":
      return "进行中";
    case "pending":
      return "待处理";
    case "skipped":
      return "已跳过";
    default:
      return status;
  }
}
