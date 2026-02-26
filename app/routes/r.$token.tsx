import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { resolvePublicVerificationReportByToken } from "../services/report-share.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = params.token?.trim();
  if (!token) {
    throw new Response("Invalid share link", { status: 400 });
  }
  const report = await resolvePublicVerificationReportByToken(token);
  if (!report) {
    throw new Response("Share link expired or revoked", { status: 404 });
  }
  return json({ report });
};

export default function PublicVerificationReportPage() {
  const { report } = useLoaderData<typeof loader>();
  const successRate = report.summary.totalTests > 0
    ? Math.round((report.summary.passedTests / report.summary.totalTests) * 100)
    : 0;
  return (
    <main style={{ maxWidth: 960, margin: "40px auto", fontFamily: "Inter, Arial, sans-serif", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 8 }}>Tracking Guardian 验收报告分享</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        链接标识: {report.share.tokenPrefix} · 到期时间: {new Date(report.share.expiresAt).toLocaleString()}
      </p>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>{report.runName}</h2>
        <p>状态: {report.status}</p>
        <p>测试类型: {report.runType}</p>
        <p>平台: {report.platforms.join(", ") || "-"}</p>
        <p>完成时间: {report.completedAt ? new Date(report.completedAt).toLocaleString() : "-"}</p>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>摘要</h3>
        <p>总测试: {report.summary.totalTests}</p>
        <p>通过: {report.summary.passedTests}</p>
        <p>失败: {report.summary.failedTests}</p>
        <p>参数完整度: {report.summary.parameterCompleteness.toFixed(1)}%</p>
        <p>数值准确率: {report.summary.valueAccuracy.toFixed(1)}%</p>
        <p>通过率: {successRate}%</p>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>事件样本（最多 100 条，订单号已脱敏）</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>事件</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>平台</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>订单</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>状态</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>金额</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>币种</th>
              </tr>
            </thead>
            <tbody>
              {report.events.map((event, idx) => (
                <tr key={`${event.eventType}-${idx}`}>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{event.eventType}</td>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{event.platform}</td>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{event.orderId || "-"}</td>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{event.status}</td>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px", textAlign: "right" }}>
                    {event.params?.value?.toFixed(2) || "-"}
                  </td>
                  <td style={{ borderBottom: "1px solid #f3f4f6", padding: "8px 6px" }}>{event.params?.currency || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
