
import type { VerificationSummary, VerificationEventResult } from "./verification.server";
import { logger } from "../utils/logger.server";
import prisma from "../db.server";
import { getVerificationRun } from "./verification.server";

/**
 * 获取验收报告数据（兼容现有接口）
 */
export async function generateVerificationReportData(
  shopId: string,
  runId?: string
): Promise<VerificationSummary | null> {
  if (runId) {
    return await getVerificationRun(runId);
  }
  
  // 如果没有提供 runId，获取最新的运行
  const latestRun = await prisma.verificationRun.findFirst({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
  
  if (!latestRun) {
    return null;
  }
  
  return await getVerificationRun(latestRun.id);
}

/**
 * 生成验收报告 HTML（兼容现有接口）
 */
export function generateVerificationReportHtml(summary: VerificationSummary): string {
  const passRate = summary.totalTests > 0
    ? Math.round((summary.passedTests / summary.totalTests) * 100)
    : 0;
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>验收测试报告</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    h2 { color: #666; margin-top: 30px; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
    .success { color: green; }
    .failed { color: red; }
    .warning { color: orange; }
  </style>
</head>
<body>
  <h1>验收测试报告</h1>
  <h2>基本信息</h2>
  <p><strong>运行名称:</strong> ${summary.runName}</p>
  <p><strong>运行类型:</strong> ${summary.runType === "quick" ? "快速" : summary.runType === "full" ? "完整" : "自定义"}</p>
  <p><strong>状态:</strong> ${summary.status === "completed" ? "已完成" : summary.status === "running" ? "运行中" : "待运行"}</p>
  ${summary.startedAt ? `<p><strong>开始时间:</strong> ${new Date(summary.startedAt).toLocaleString("zh-CN")}</p>` : ""}
  ${summary.completedAt ? `<p><strong>完成时间:</strong> ${new Date(summary.completedAt).toLocaleString("zh-CN")}</p>` : ""}
  
  <h2>测试摘要</h2>
  <table>
    <tr>
      <th>指标</th>
      <th>数值</th>
    </tr>
    <tr>
      <td>总测试数</td>
      <td>${summary.totalTests}</td>
    </tr>
    <tr>
      <td>通过</td>
      <td class="success">${summary.passedTests}</td>
    </tr>
    <tr>
      <td>失败</td>
      <td class="failed">${summary.failedTests}</td>
    </tr>
    <tr>
      <td>参数缺失</td>
      <td class="warning">${summary.missingParamTests}</td>
    </tr>
    <tr>
      <td>通过率</td>
      <td>${passRate}%</td>
    </tr>
    <tr>
      <td>参数完整率</td>
      <td>${summary.parameterCompleteness.toFixed(1)}%</td>
    </tr>
    <tr>
      <td>金额准确率</td>
      <td>${summary.valueAccuracy.toFixed(1)}%</td>
    </tr>
  </table>
  
  ${summary.results && summary.results.length > 0 ? `
  <h2>详细结果</h2>
  <table>
    <tr>
      <th>事件类型</th>
      <th>平台</th>
      <th>订单ID</th>
      <th>状态</th>
      <th>金额</th>
      <th>差异</th>
    </tr>
    ${summary.results.map(event => `
    <tr>
      <td>${event.eventType}</td>
      <td>${event.platform}</td>
      <td>${event.orderId || "-"}</td>
      <td class="${event.status === "success" ? "success" : event.status === "failed" ? "failed" : "warning"}">${event.status}</td>
      <td>${event.params?.value ? `${event.params.currency || "USD"} ${event.params.value.toFixed(2)}` : "-"}</td>
      <td>${event.discrepancies?.join("; ") || "-"}</td>
    </tr>
    `).join("")}
  </table>
  ` : ""}
</body>
</html>
  `;
}

/**
 * 生成验收报告 PDF
 * 
 * 注意：需要安装 pdfkit 依赖：
 * pnpm add pdfkit @types/pdfkit
 */
export async function generateVerificationReportPDF(
  summary: VerificationSummary,
  shopDomain: string
): Promise<Buffer> {
  try {
    // 动态导入 pdfkit（如果未安装会抛出错误）
    const PDFDocument = (await import("pdfkit")).default;
    
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });

    // 标题
    doc.fontSize(20).font("Helvetica-Bold").text("验收测试报告", { align: "center" });
    doc.moveDown(0.5);
    
    // 基本信息
    doc.fontSize(12).font("Helvetica");
    doc.text(`店铺: ${shopDomain}`);
    doc.text(`报告生成时间: ${new Date().toISOString().split("T")[0]}`);
    doc.text(`验收运行 ID: ${summary.runId}`);
    doc.text(`运行名称: ${summary.runName}`);
    doc.text(`运行类型: ${summary.runType === "quick" ? "快速" : summary.runType === "full" ? "完整" : "自定义"}`);
    if (summary.startedAt) {
      doc.text(`开始时间: ${new Date(summary.startedAt).toLocaleString("zh-CN")}`);
    }
    if (summary.completedAt) {
      doc.text(`完成时间: ${new Date(summary.completedAt).toLocaleString("zh-CN")}`);
    }
    doc.moveDown();

    // 测试摘要
    doc.fontSize(16).font("Helvetica-Bold").text("测试摘要");
    doc.fontSize(11).font("Helvetica");
    doc.text(`总测试数: ${summary.totalTests}`);
    doc.text(`通过: ${summary.passedTests}`);
    doc.text(`失败: ${summary.failedTests}`);
    doc.text(`参数缺失: ${summary.missingParamTests}`);
    doc.text(`未测试: ${summary.notTestedCount || 0}`);
    
    const passRate = summary.totalTests > 0
      ? Math.round((summary.passedTests / summary.totalTests) * 100)
      : 0;
    doc.text(`通过率: ${passRate}%`);
    doc.text(`参数完整率: ${summary.parameterCompleteness.toFixed(1)}%`);
    doc.text(`金额准确率: ${summary.valueAccuracy.toFixed(1)}%`);
    doc.moveDown();

    // 平台结果
    if (summary.platformResults) {
      doc.fontSize(14).font("Helvetica-Bold").text("平台结果");
      doc.fontSize(10).font("Helvetica");
      
      for (const [platform, result] of Object.entries(summary.platformResults)) {
        doc.text(`${platform}:`);
        doc.text(`  发送成功: ${result.sent || 0}`);
        doc.text(`  发送失败: ${result.failed || 0}`);
        doc.moveDown(0.3);
      }
      doc.moveDown();
    }

    // 事件详情
    if (summary.results && summary.results.length > 0) {
      doc.fontSize(16).font("Helvetica-Bold").text("事件详情", { pageBreak: false });
      doc.moveDown(0.5);

      summary.results.slice(0, 50).forEach((event, index) => {
        // 检查是否需要分页
        if (doc.y > 700) {
          doc.addPage();
        }

        doc.fontSize(11).font("Helvetica-Bold");
        doc.text(`${index + 1}. ${event.eventType} (${event.platform})`);
        
        doc.fontSize(10).font("Helvetica");
        if (event.orderId) {
          doc.text(`  订单 ID: ${event.orderId}`);
        }
        if (event.orderNumber) {
          doc.text(`  订单号: ${event.orderNumber}`);
        }
        const statusText = event.status === "success" ? "成功" 
          : event.status === "failed" ? "失败" 
          : event.status === "missing_params" ? "参数缺失"
          : "未测试";
        doc.text(`  状态: ${statusText}`);
        
        if (event.params) {
          if (event.params.value !== undefined) {
            doc.text(`  金额: ${event.params.currency || "USD"} ${event.params.value.toFixed(2)}`);
          }
          if (event.params.items !== undefined) {
            doc.text(`  商品数: ${event.params.items}`);
          }
        }
        
        if (event.shopifyOrder) {
          doc.text(`  Shopify 订单金额: ${event.shopifyOrder.currency} ${event.shopifyOrder.value.toFixed(2)}`);
        }
        
        if (event.discrepancies && event.discrepancies.length > 0) {
          doc.text(`  差异: ${event.discrepancies.join("; ")}`);
        }
        
        if (event.errors && event.errors.length > 0) {
          doc.text(`  错误: ${event.errors.join("; ")}`);
        }
        
        doc.moveDown(0.5);
        
        // 分隔线
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.3);
      });
    }

    // 对账结果
    if (summary.reconciliation) {
      doc.addPage();
      doc.fontSize(16).font("Helvetica-Bold").text("对账结果");
      doc.fontSize(11).font("Helvetica");
      doc.text(`订单总数: ${summary.reconciliation.totalOrders || 0}`);
      doc.text(`匹配成功: ${summary.reconciliation.matchedOrders || 0}`);
      doc.text(`匹配失败: ${summary.reconciliation.unmatchedOrders || 0}`);
      
      const matchRate = summary.reconciliation.totalOrders > 0
        ? Math.round((summary.reconciliation.matchedOrders / summary.reconciliation.totalOrders) * 100)
        : 0;
      doc.text(`匹配率: ${matchRate}%`);
    }

    // 页脚
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

    // 生成 PDF buffer
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
    logger.error("Failed to generate verification PDF", { error });
    throw error;
  }
}

/**
 * 生成验收报告 CSV
 */
export function generateVerificationReportCSV(
  summary: VerificationSummary,
  shopDomain: string
): string {
  const rows: string[][] = [];
  
  // 表头
  rows.push([
    "测试项ID",
    "事件类型",
    "平台",
    "订单ID",
    "订单号",
    "状态",
    "金额",
    "币种",
    "商品数",
    "Shopify订单金额",
    "差异",
    "错误信息",
    "触发时间",
  ]);

  // 事件数据
  if (summary.results && summary.results.length > 0) {
    for (const event of summary.results) {
      const discrepancies = event.discrepancies?.join("; ") || "";
      const errors = event.errors?.join("; ") || "";
      const shopifyValue = event.shopifyOrder 
        ? `${event.shopifyOrder.currency} ${event.shopifyOrder.value.toFixed(2)}`
        : "";
      
      rows.push([
        event.testItemId || "",
        event.eventType,
        event.platform,
        event.orderId || "",
        event.orderNumber || "",
        event.status,
        event.params?.value?.toFixed(2) || "",
        event.params?.currency || "",
        event.params?.items?.toString() || "",
        shopifyValue,
        discrepancies,
        errors,
        event.triggeredAt ? new Date(event.triggeredAt).toISOString() : "",
      ]);
    }
  }

  // 转换为 CSV 格式
  return rows.map(row => {
    return row.map(cell => {
      // 转义包含逗号、引号或换行符的单元格
      if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(",");
  }).join("\n");
}

/**
 * 保存报告到数据库（可选，用于后续下载）
 */
export async function saveVerificationReport(
  runId: string,
  reportType: "pdf" | "csv",
  reportData: Buffer | string,
  shopDomain: string
): Promise<string> {
  try {
    // 更新 VerificationRun 记录，保存报告 URL 或路径
    const filename = `verification-report-${shopDomain}-${runId}-${new Date().toISOString().split("T")[0]}.${reportType}`;
    
    // 这里可以保存到 S3 或其他存储服务
    // 暂时只更新数据库记录
    await prisma.verificationRun.update({
      where: { id: runId },
      data: {
        reportUrl: `/api/reports/verification/${runId}.${reportType}`, // 临时 URL
      },
    });

    logger.info("Verification report saved", { runId, reportType, filename });
    return filename;
  } catch (error) {
    logger.error("Failed to save verification report", { runId, error });
    throw error;
  }
}
