import PDFDocument from "pdfkit";
import type { MigrationChecklist } from "./migration-checklist.server";

export async function generateChecklistPDF(
  checklist: MigrationChecklist,
  shopDomain: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      
      
      doc.fontSize(24).text("迁移清单", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`店铺: ${shopDomain}`, { align: "center" });
      doc.text(`生成时间: ${checklist.generatedAt.toLocaleString("zh-CN")}`, { align: "center" });
      doc.moveDown();
      
      
      doc.fontSize(16).text("摘要", { underline: true });
      doc.fontSize(12);
      doc.text(`总项目数: ${checklist.totalItems}`);
      doc.text(`高优先级: ${checklist.highPriorityItems}`);
      doc.text(`中优先级: ${checklist.mediumPriorityItems}`);
      doc.text(`低优先级: ${checklist.lowPriorityItems}`);
      doc.text(`预计总时间: ${formatTime(checklist.estimatedTotalTime)}`);
      doc.moveDown();
      
      
      doc.fontSize(16).text("详细清单", { underline: true });
      doc.fontSize(12);
      
      checklist.items.forEach((item, index) => {
        if (index > 0) {
          doc.moveDown(0.5);
        }
        
        
        if (doc.y > 750) {
          doc.addPage();
        }
        
        const riskLevelText = item.riskLevel === "high" ? "高" : item.riskLevel === "medium" ? "中" : "低";
        const migrationText = 
          item.suggestedMigration === "web_pixel" ? "Web Pixel" :
          item.suggestedMigration === "ui_extension" ? "UI Extension Block" :
          item.suggestedMigration === "server_side" ? "Server-side CAPI" :
          "External redirect / not supported";
        
        doc.font("Helvetica-Bold").text(`${index + 1}. ${item.title}`, { continued: false });
        doc.font("Helvetica");
        doc.fontSize(10).text(`   类别: ${item.category}${item.platform ? ` | 平台: ${item.platform}` : ""}`);
        doc.text(`   风险等级: ${riskLevelText} - ${item.riskReason}`);
        doc.text(`   推荐迁移路径: ${migrationText}`);
        doc.text(`   预计工时: ${formatTime(item.estimatedTime)}`);
        doc.text(`   需要的信息: ${item.requiredInfo}`);
        doc.text(`   状态: ${getStatusText(item.status)}`);
        
        if (item.description) {
          doc.fontSize(9).text(`   描述: ${item.description}`, { 
            width: 480,
            ellipsis: true 
          });
        }
      });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
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
