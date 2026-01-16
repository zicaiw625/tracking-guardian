import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData } from "@remix-run/react";
import { useState, Suspense, lazy } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Divider,
  ProgressBar,
  DataTable,
  List,
  Box,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ExportIcon,
  RefreshIcon,
  FileIcon,
} from "~/components/icons";
import { CardSkeleton, useToastContext, EnhancedEmptyState } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getVerificationRun,
  type VerificationSummary,
} from "../services/verification.server";
import {
  generateVerificationReportData,
  generateVerificationReportCSV,
  type VerificationReportData,
} from "../services/verification-report.server";
import {
  checkFeatureAccess,
  type FeatureGateResult,
} from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId, planSupportsReportExport } from "../services/billing/plans";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";
import { trackEvent } from "../services/analytics.server";
import { safeFireAndForget } from "../utils/helpers.server";
import { sanitizeFilename } from "../utils/responses";

const ReportComparison = lazy(() => import("~/components/verification/ReportComparison").then(module => ({
  default: module.ReportComparison,
})));

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const runId = params.runId;
  if (!runId) {
    throw new Response("Missing runId", { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      plan: true,
    },
  });
  if (!shop) {
    return json({
      shop: null,
      run: null,
      reportData: null,
      canExportReports: false,
      gateResult: undefined,
      currentPlan: "free" as PlanId,
    });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "verification");
  const canExportReports = planSupportsReportExport(planId);
  const run = await getVerificationRun(runId);
  if (!run || run.shopId !== shop.id) {
    return json({
      shop: { id: shop.id, domain: shopDomain },
      run: null,
      reportData: null,
      canExportReports,
      gateResult: gateResult.allowed ? undefined : gateResult,
      currentPlan: planId,
    });
  }
  const reportData = await generateVerificationReportData(shop.id, runId);
    if (!canExportReports && reportData) {
    safeFireAndForget(
      trackEvent({
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        event: "app_paywall_viewed",
        metadata: {
          triggerPage: "verification_report",
          plan: shop.plan ?? "free",
          runId,
        },
      })
    );
  }
  return json({
    shop: { id: shop.id, domain: shopDomain },
    run,
    reportData,
    canExportReports,
    gateResult: gateResult.allowed ? undefined : gateResult,
    currentPlan: planId,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const runId = params.runId;
  const formData = await request.formData();
  const actionType = formData.get("_action");
  if (!runId) {
    return json({ success: false, error: "Missing runId" }, { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const canExportReports = planSupportsReportExport(planId);
  if (actionType === "export_pdf") {
    if (!canExportReports) {
      return json({ success: false, error: "需要 Growth 或 Agency 套餐才能导出报告" }, { status: 403 });
    }
    const reportData = await generateVerificationReportData(shop.id, runId);
    if (!reportData) {
      return json({ success: false, error: "报告数据未找到" }, { status: 404 });
    }
    const { generateVerificationReportPDF } = await import("../services/verification-report.server");
    const pdfBuffer = await generateVerificationReportPDF(reportData);
    if (!pdfBuffer) {
      return json({ success: false, error: "PDF生成失败" }, { status: 500 });
    }
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `verification-report-${shopDomain.replace(/\./g, "_")}-${timestamp}.pdf`;
    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
      },
    });
  }
  if (actionType === "export_csv") {
    if (!canExportReports) {
      return json({ success: false, error: "需要 Growth 或 Agency 套餐才能导出报告" }, { status: 403 });
    }
    const reportData = await generateVerificationReportData(shop.id, runId);
    if (!reportData) {
      return json({ success: false, error: "报告数据未找到" }, { status: 404 });
    }
    const csv = generateVerificationReportCSV(reportData);
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `verification-report-${shopDomain.replace(/\./g, "_")}-${timestamp}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
      },
    });
  }
  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

export default function VerificationReportPage() {
  const { shop, run, reportData, canExportReports, gateResult, currentPlan } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const actionData = useActionData<typeof action>();
  const { showError } = useToastContext();
  const [isExporting, setIsExporting] = useState(false);
  if (!shop) {
    return (
      <Page title="验收报告">
        <Banner tone="warning">
          <Text as="p">店铺信息未找到，请重新安装应用。</Text>
        </Banner>
      </Page>
    );
  }
  if (!run || !reportData) {
    return (
      <Page title="验收报告">
        <EnhancedEmptyState
          icon="⚠️"
          title="报告未找到"
          description="验收运行记录不存在或无权访问。"
          primaryAction={{ content: "返回验收页面", url: "/app/verification" }}
        />
      </Page>
    );
  }
  const handleExportPDF = () => {
    setIsExporting(true);
    const formData = new FormData();
    formData.append("_action", "export_pdf");
    submit(formData, { method: "post" });
    setTimeout(() => setIsExporting(false), 2000);
  };
  const handleExportCSV = () => {
    setIsExporting(true);
    const formData = new FormData();
    formData.append("_action", "export_csv");
    submit(formData, { method: "post" });
    setTimeout(() => setIsExporting(false), 2000);
  };
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge tone="success">已完成</Badge>;
      case "running":
        return <Badge tone="info">进行中</Badge>;
      case "failed":
        return <Badge tone="critical">失败</Badge>;
      default:
        return <Badge>待开始</Badge>;
    }
  };
  const formatDate = (date?: Date) => {
    if (!date) return "未开始";
    return new Date(date).toLocaleString("zh-CN");
  };
  return (
    <Page
      title={`验收报告 - ${reportData.runName}`}
      subtitle="PRD 2.5: 导出验收报告（PDF/CSV）"
      backAction={{ content: "返回验收页面", url: "/app/verification" }}
      primaryAction={
        canExportReports
          ? {
              content: "导出 PDF",
              icon: ExportIcon,
              onAction: handleExportPDF,
              loading: isExporting,
            }
          : undefined
      }
      secondaryActions={
        canExportReports
          ? [
              {
                content: "导出 CSV",
                icon: FileIcon,
                onAction: handleExportCSV,
                loading: isExporting,
              },
            ]
          : []
      }
    >
      <BlockStack gap="500">
        <PageIntroCard
          title="验收报告说明"
          description="报告用于交付验收结果，包含事件触发、参数完整率与一致性检查。"
          items={[
            "支持 PDF/CSV 导出",
            "可用于客户/管理层验收签收",
          ]}
          primaryAction={{ content: "返回验收", url: "/app/verification" }}
          secondaryAction={{ content: "报告中心", url: "/app/reports" }}
        />
        {!canExportReports && (
          <UpgradePrompt
            feature="verification"
            currentPlan={currentPlan}
            gateResult={gateResult}
          />
        )}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                报告信息
              </Text>
              {getStatusBadge(reportData.status)}
            </InlineStack>
            <Divider />
            <Layout>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    报告名称
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {reportData.runName}
                  </Text>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    测试类型
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {reportData.runType === "quick" ? "快速测试" : reportData.runType === "full" ? "完整测试" : "自定义测试"}
                  </Text>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    完成时间
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {formatDate(reportData.completedAt)}
                  </Text>
                </BlockStack>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              测试摘要
            </Text>
            <Layout>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {reportData.summary.totalTests}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      总测试数
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="success">
                      {reportData.summary.passedTests}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      通过
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="critical">
                      {reportData.summary.failedTests}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      失败
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
            </Layout>
            <Divider />
            <BlockStack gap="300">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    参数完整率
                  </Text>
                  <Text as="span" variant="headingMd" tone={reportData.summary.parameterCompleteness >= 90 ? "success" : reportData.summary.parameterCompleteness >= 70 ? "warning" : "critical"}>
                    {reportData.summary.parameterCompleteness.toFixed(1)}%
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={reportData.summary.parameterCompleteness}
                  tone={reportData.summary.parameterCompleteness >= 90 ? "success" : reportData.summary.parameterCompleteness >= 70 ? "highlight" : "critical"}
                />
              </BlockStack>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    金额准确率
                  </Text>
                  <Text as="span" variant="headingMd" tone={reportData.summary.valueAccuracy >= 95 ? "success" : reportData.summary.valueAccuracy >= 80 ? "warning" : "critical"}>
                    {reportData.summary.valueAccuracy.toFixed(1)}%
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={reportData.summary.valueAccuracy}
                  tone={reportData.summary.valueAccuracy >= 95 ? "success" : reportData.summary.valueAccuracy >= 80 ? "highlight" : "critical"}
                />
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Card>
        {Object.keys(reportData.platformResults).length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                平台统计
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                headings={["平台", "成功发送", "发送失败", "成功率"]}
                rows={Object.entries(reportData.platformResults).map(([platform, stats]) => {
                  const total = stats.sent + stats.failed;
                  const successRate = total > 0 ? Math.round((stats.sent / total) * 100) : 0;
                  return [
                    platform,
                    String(stats.sent),
                    String(stats.failed),
                    `${successRate}%`,
                  ];
                })}
              />
            </BlockStack>
          </Card>
        )}
        {reportData.events.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                事件详情
              </Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    💡 <strong>注意：</strong>以下事件包含发往平台的请求 payload 证据链。如果某些字段（如姓名、邮箱、电话、地址）为 null，可能是由于 PCD (Protected Customer Data) 需要额外 scope 审批（2025-12-10 起生效）或用户未同意 consent。这是 Shopify 平台的合规行为，不是故障。
                  </Text>
                  <Text as="p" variant="bodySm">
                    ⚠️ <strong>Strict Sandbox 限制（已自动标注）：</strong>Web Pixel 运行在 strict sandbox (Web Worker) 环境中，无法访问 DOM、localStorage、第三方 cookie 等，部分字段可能不可用。报告中已自动标注所有因 strict sandbox 限制而无法获取的字段和事件。如果某些字段为 null 或缺失，可能是由于 strict sandbox 限制，这是平台限制，不是故障。哪些事件/哪些字段拿不到已在报告中自动标注，减少纠纷。详细说明请查看下方的"Strict Sandbox 限制说明"部分。
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    已知限制字段（可能为 null，已自动标注）：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>checkout_completed / checkout_started：</strong>buyer.email, buyer.phone, deliveryAddress, shippingAddress, billingAddress（这些字段在 Web Worker 环境中不可用，这是平台限制，不是故障。已在报告中自动标注）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>checkout_contact_info_submitted：</strong>buyer.email, buyer.phone（这些字段在 Web Worker 环境中不可用，这是平台限制，不是故障。已在报告中自动标注）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>checkout_shipping_info_submitted：</strong>deliveryAddress, shippingAddress（这些字段在 Web Worker 环境中不可用，这是平台限制，不是故障。已在报告中自动标注）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>payment_info_submitted：</strong>billingAddress（这些字段在 Web Worker 环境中不可用，这是平台限制，不是故障。已在报告中自动标注）
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    不可用的事件类型（已自动标注，需要通过订单 webhooks 获取）：
                  </Text>
                  <Text as="p" variant="bodySm">
                    refund, order_cancelled, order_edited, subscription_created, subscription_updated, subscription_cancelled（这些事件在 strict sandbox 中不可用，需要通过订单 webhooks 获取。已在报告中自动标注）
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    💡 <strong>自动标注说明：</strong>报告中已自动标注所有因 strict sandbox 限制而无法获取的字段和事件。这些限制是 Shopify 平台的设计限制，不是故障。哪些事件/哪些字段拿不到已在报告中自动标注，减少纠纷。如需获取这些字段或事件，请使用订单 webhooks 或其他 Shopify API。详细说明请查看下方的"Strict Sandbox 限制说明"部分。
                  </Text>
                </BlockStack>
              </Banner>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "numeric", "text", "text", "text"]}
                headings={["测试项", "事件类型", "平台", "订单ID", "状态", "金额", "币种", "问题", "Sandbox限制"]}
                rows={reportData.events.slice(0, 50).map((event) => [
                  event.testItemId,
                  event.eventType,
                  event.platform,
                  event.orderId || "",
                  event.status,
                  event.params?.value?.toFixed(2) || "",
                  event.params?.currency || "",
                  event.discrepancies?.join("; ") || event.errors?.join("; ") || "",
                  event.sandboxLimitations?.join("; ") || "",
                ])}
              />
              {reportData.events.length > 50 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  仅显示前 50 条事件，完整数据请导出报告查看。
                </Text>
              )}
            </BlockStack>
          </Card>
        )}
        {reportData.sandboxLimitations && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Strict Sandbox 限制说明
              </Text>
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ⚠️ Web Pixel 运行在 Strict Sandbox (Web Worker) 环境中
                  </Text>
                  <Text as="p" variant="bodySm">
                    Web Pixel 运行在 strict sandbox (Web Worker) 环境中，以下能力受限：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法访问 DOM 元素
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法使用 localStorage/sessionStorage
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法访问第三方 cookie
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法执行某些浏览器 API
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        部分事件字段可能为 null 或 undefined，这是平台限制，不是故障
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
              {reportData.sandboxLimitations.missingFields.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    缺失字段（由于 strict sandbox 限制，已自动标注）
                  </Text>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      以下字段因 strict sandbox 限制而无法获取，这是平台限制，不是故障。报告中已自动标注这些限制。哪些事件/哪些字段拿不到已在报告中自动标注，减少纠纷。
                    </Text>
                  </Banner>
                  {reportData.sandboxLimitations.missingFields.map((item, index) => (
                    <Box key={index} background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          事件类型：{item.eventType}
                        </Text>
                        <Text as="p" variant="bodySm">
                          缺失字段（已自动标注）：{item.fields.join(", ")}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          原因：{item.reason}
                        </Text>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
              {reportData.sandboxLimitations.unavailableEvents.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    不可用的事件类型（已自动标注）
                  </Text>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      以下事件类型在 strict sandbox 中不可用，需要通过订单 webhooks 获取。报告中已自动标注这些限制。哪些事件/哪些字段拿不到已在报告中自动标注，减少纠纷。
                    </Text>
                  </Banner>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <Text as="p" variant="bodySm">
                      {reportData.sandboxLimitations.unavailableEvents.join(", ")}
                    </Text>
                  </Box>
                </BlockStack>
              )}
              {reportData.sandboxLimitations.notes.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    自动标注说明
                  </Text>
                  <Banner tone="info">
                    <BlockStack gap="200">
                      {reportData.sandboxLimitations.notes.map((note, index) => (
                        <Text key={index} as="p" variant="bodySm">
                          {note}
                        </Text>
                      ))}
                    </BlockStack>
                  </Banner>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}
        {reportData.reconciliation && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                渠道对账结果
              </Text>
              {reportData.reconciliation.localConsistency && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    本地一致性检查
                  </Text>
                  <Layout>
                    <Layout.Section variant="oneThird">
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="100" align="center">
                          <Text as="p" variant="headingLg" fontWeight="bold">
                            {reportData.reconciliation.localConsistency.totalChecked}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            检查订单数
                          </Text>
                        </BlockStack>
                      </Box>
                    </Layout.Section>
                    <Layout.Section variant="oneThird">
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="100" align="center">
                          <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                            {reportData.reconciliation.localConsistency.consistent}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            一致
                          </Text>
                        </BlockStack>
                      </Box>
                    </Layout.Section>
                    <Layout.Section variant="oneThird">
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="100" align="center">
                          <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                            {reportData.reconciliation.localConsistency.inconsistent}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            不一致
                          </Text>
                        </BlockStack>
                      </Box>
                    </Layout.Section>
                  </Layout>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}
        {!canExportReports && (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                <strong>导出报告需要升级：</strong>验收报告导出（PDF/CSV）是核心付费点，需要 Growth ($79/月) 或 Agency ($199/月) 套餐。
              </Text>
              <Button url="/app/billing?upgrade=growth" variant="primary">
                升级解锁
              </Button>
            </BlockStack>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}
