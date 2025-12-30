
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { VerificationSummary } from "./verification.server";
import { getVerificationRun } from "./verification.server";

export interface ReportOptions {
  format: "pdf" | "csv";
  includeCharts?: boolean;
  includeDetails?: boolean;
}

export async function generateVerificationReport(
  runId: string,
  options: ReportOptions
): Promise<{ url: string; filename: string }> {
  const verification = await getVerificationRun(runId);
  if (!verification) {
    throw new Error("Verification run not found");
  }

  if (options.format === "csv") {
    return generateCSVReport(verification, options);
  } else {
    return generatePDFReport(verification, options);
  }
}

async function generateCSVReport(
  verification: VerificationSummary,
  options: ReportOptions
): Promise<{ url: string; filename: string }> {
  const rows: string[][] = [];

  // 表头
  rows.push([
    "测试项",
    "事件类型",
    "平台",
    "订单ID",
    "状态",
    "触发时间",
    "订单金额",
    "货币",
    "商品数量",
    "差异",
    "错误",
  ]);

  // 数据行
  verification.results.forEach((result) => {
    rows.push([
      result.testItemId || "",
      result.eventType,
      result.platform,
      result.orderId || "",
      result.status,
      result.triggeredAt?.toISOString() || "",
      result.params?.value?.toString() || "",
      result.params?.currency || "",
      result.params?.items?.toString() || "",
      result.discrepancies?.join("; ") || "",
      result.errors?.join("; ") || "",
    ]);
  });

  // 转换为 CSV 格式
  const csvContent = rows.map(row => 
    row.map(cell => {
      // 转义 CSV 特殊字符
      const cellStr = String(cell || "");
      if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    }).join(",")
  ).join("\n");

  // 添加摘要信息
  const summary = [
    "",
    "摘要",
    `总测试数,${verification.totalTests}`,
    `通过,${verification.passedTests}`,
    `失败,${verification.failedTests}`,
    `参数缺失,${verification.missingParamTests}`,
    `未测试,${verification.notTestedCount}`,
    `参数完整率,${verification.parameterCompleteness.toFixed(2)}%`,
    `金额准确率,${verification.valueAccuracy.toFixed(2)}%`,
  ].join("\n");

  const fullContent = csvContent + "\n" + summary;

  // 保存到数据库（实际应用中应该保存到 S3 或其他存储）
  const filename = `verification-report-${verification.runId}-${Date.now()}.csv`;
  
  // 更新 VerificationRun 的 reportUrl
  await prisma.verificationRun.update({
    where: { id: verification.runId },
    data: {
      reportUrl: `/api/reports/${filename}`,
    },
  });

  // 返回数据 URL（实际应用中应该返回文件存储 URL）
  const blob = new Blob([fullContent], { type: "text/csv;charset=utf-8;" });
  const dataUrl = URL.createObjectURL(blob);

  return {
    url: dataUrl,
    filename,
  };
}

async function generatePDFReport(
  verification: VerificationSummary,
  options: ReportOptions
): Promise<{ url: string; filename: string }> {
  // PDF 生成需要额外的库（如 pdfkit 或 puppeteer）
  // 这里提供一个基础实现框架
  
  try {
    // 动态导入 PDF 库（如果可用）
    const PDFDocument = await import("pdfkit").catch(() => null);
    
    if (!PDFDocument) {
      // 如果没有 PDF 库，返回 HTML 报告
      return generateHTMLReport(verification, options);
    }

    const doc = new PDFDocument.default({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    
    // 标题
    doc.fontSize(20).text("迁移验收报告", { align: "center" });
    doc.moveDown();

    // 基本信息
    doc.fontSize(12);
    doc.text(`运行名称: ${verification.runName}`);
    doc.text(`运行类型: ${verification.runType}`);
    doc.text(`状态: ${verification.status}`);
    doc.text(`开始时间: ${verification.startedAt?.toLocaleString() || "N/A"}`);
    doc.text(`完成时间: ${verification.completedAt?.toLocaleString() || "N/A"}`);
    doc.moveDown();

    // 摘要
    doc.fontSize(16).text("摘要", { underline: true });
    doc.fontSize(12);
    doc.text(`总测试数: ${verification.totalTests}`);
    doc.text(`通过: ${verification.passedTests}`);
    doc.text(`失败: ${verification.failedTests}`);
    doc.text(`参数缺失: ${verification.missingParamTests}`);
    doc.text(`参数完整率: ${verification.parameterCompleteness.toFixed(2)}%`);
    doc.text(`金额准确率: ${verification.valueAccuracy.toFixed(2)}%`);
    doc.moveDown();

    // 详细结果
    if (options.includeDetails) {
      doc.fontSize(16).text("详细结果", { underline: true });
      doc.fontSize(10);
      
      verification.results.forEach((result, index) => {
        if (index > 0) doc.moveDown(0.5);
        doc.text(`${index + 1}. ${result.testItemId || result.eventType}`, { continued: false });
        doc.text(`   平台: ${result.platform}`, { indent: 20 });
        doc.text(`   状态: ${result.status}`, { indent: 20 });
        if (result.orderId) {
          doc.text(`   订单ID: ${result.orderId}`, { indent: 20 });
        }
        if (result.errors && result.errors.length > 0) {
          doc.text(`   错误: ${result.errors.join(", ")}`, { indent: 20 });
        }
      });
    }

    doc.end();

    // 等待 PDF 生成完成
    await new Promise<void>((resolve) => {
      doc.on("end", resolve);
    });

    const pdfBuffer = Buffer.concat(chunks);
    const filename = `verification-report-${verification.runId}-${Date.now()}.pdf`;

    // 更新数据库
    await prisma.verificationRun.update({
      where: { id: verification.runId },
      data: {
        reportUrl: `/api/reports/${filename}`,
      },
    });

    // 返回数据 URL（实际应用中应该保存到文件存储）
    const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;

    return {
      url: dataUrl,
      filename,
    };
  } catch (error) {
    logger.error("PDF generation failed, falling back to HTML", { error });
    return generateHTMLReport(verification, options);
  }
}

async function generateHTMLReport(
  verification: VerificationSummary,
  options: ReportOptions
): Promise<{ url: string; filename: string }> {
  // 生成 HTML 报告（可以作为 PDF 的替代或中间步骤）
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>迁移验收报告 - ${verification.runName}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
    .summary { background-color: #f9f9f9; padding: 15px; margin: 20px 0; }
    .success { color: green; }
    .failed { color: red; }
    .warning { color: orange; }
  </style>
</head>
<body>
  <h1>迁移验收报告</h1>
  <div class="summary">
    <h2>摘要</h2>
    <p><strong>运行名称:</strong> ${verification.runName}</p>
    <p><strong>运行类型:</strong> ${verification.runType}</p>
    <p><strong>状态:</strong> ${verification.status}</p>
    <p><strong>总测试数:</strong> ${verification.totalTests}</p>
    <p><strong>通过:</strong> <span class="success">${verification.passedTests}</span></p>
    <p><strong>失败:</strong> <span class="failed">${verification.failedTests}</span></p>
    <p><strong>参数完整率:</strong> ${verification.parameterCompleteness.toFixed(2)}%</p>
    <p><strong>金额准确率:</strong> ${verification.valueAccuracy.toFixed(2)}%</p>
  </div>
  <h2>详细结果</h2>
  <table>
    <thead>
      <tr>
        <th>测试项</th>
        <th>事件类型</th>
        <th>平台</th>
        <th>订单ID</th>
        <th>状态</th>
        <th>订单金额</th>
        <th>货币</th>
        <th>错误</th>
      </tr>
    </thead>
    <tbody>
      ${verification.results.map(result => `
        <tr>
          <td>${result.testItemId || ""}</td>
          <td>${result.eventType}</td>
          <td>${result.platform}</td>
          <td>${result.orderId || ""}</td>
          <td class="${result.status === "success" ? "success" : result.status === "failed" ? "failed" : "warning"}">${result.status}</td>
          <td>${result.params?.value || ""}</td>
          <td>${result.params?.currency || ""}</td>
          <td>${result.errors?.join(", ") || ""}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</body>
</html>
  `;

  const filename = `verification-report-${verification.runId}-${Date.now()}.html`;
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  await prisma.verificationRun.update({
    where: { id: verification.runId },
    data: {
      reportUrl: `/api/reports/${filename}`,
    },
  });

  return {
    url: dataUrl,
    filename,
  };
}

