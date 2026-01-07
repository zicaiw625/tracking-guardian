import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { useMemo } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkFeatureAccess } from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import {
  createReportJob,
  getShopReportJobs,
  type ReportFormat,
  type ReportJob,
  type ReportType,
} from "../services/report-job.server";

type ActionData = {
  error?: string;
  jobId?: string;
};

const REPORT_LABELS: Record<ReportType, string> = {
  scan: "扫描报告",
  migration: "迁移报告",
  reconciliation: "对账报告",
  risk: "风险报告",
  verification: "验收报告",
  comprehensive: "综合报告",
};

const STATUS_TONE: Record<NonNullable<ReportJob["status"]>, "success" | "attention" | "warning" | "critical"> = {
  completed: "success",
  processing: "attention",
  pending: "warning",
  failed: "critical",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json({
      shop: null,
      planId: "free" as PlanId,
      gateResult: checkFeatureAccess("free", "report_export"),
      jobs: [],
      latestVerificationRunId: null,
    });
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "report_export");
  const jobs = await getShopReportJobs(shop.id, 20);

  const latestVerificationRun = await prisma.verificationRun.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  return json({
    shop: { id: shop.id, domain: shopDomain },
    planId,
    gateResult,
    jobs,
    latestVerificationRunId: latestVerificationRun?.id ?? null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType !== "create_report_job") {
    return json({ error: "Unknown action" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "report_export");

  if (!gateResult.allowed) {
    return json({ error: gateResult.reason || "暂无导出权限" }, { status: 403 });
  }

  const reportType = formData.get("reportType") as ReportType | null;
  const format = formData.get("format") as ReportFormat | null;
  const runId = formData.get("runId") as string | null;

  if (!reportType || !format) {
    return json({ error: "缺少报告类型或格式" }, { status: 400 });
  }

  if (reportType === "verification" && !runId) {
    return json({ error: "验收报告需要最新的 runId" }, { status: 400 });
  }

  const job = await createReportJob({
    shopId: shop.id,
    reportType,
    format,
    metadata: runId ? { runId } : undefined,
  });

  return json<ActionData>({
    jobId: job.id,
  });
};

export default function ReportsPage() {
  const { planId, gateResult, jobs, latestVerificationRunId } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const exportOptions = useMemo(() => ([
    {
      type: "scan" as const,
      title: "扫描报告",
      description: "输出最近一次扫描结果，支持 PDF/CSV。",
      supports: ["pdf", "csv"] as const,
    },
    {
      type: "verification" as const,
      title: "验收报告",
      description: "基于最新验收运行生成 PDF/CSV。",
      supports: ["pdf", "csv"] as const,
      requiresRunId: true,
    },
    {
      type: "comprehensive" as const,
      title: "综合报告",
      description: "包含扫描、迁移、验收、风险与事件统计。",
      supports: ["pdf", "csv"] as const,
    },
  ]), []);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }),
    []
  );

  const historyRows = jobs.map((job) => {
    const label = REPORT_LABELS[job.reportType] || job.reportType;
    const createdAt = dateFormatter.format(new Date(job.createdAt));
    return [
      <Text as="span" variant="bodySm" key={`${job.id}-type`}>{label}</Text>,
      <Text as="span" variant="bodySm" key={`${job.id}-format`}>{job.format.toUpperCase()}</Text>,
      <BlockStack gap="100" key={`${job.id}-status`}>
        <Badge tone={STATUS_TONE[job.status]}>{job.status}</Badge>
        {job.error && (
          <Text as="span" variant="bodySm" tone="critical">
            {job.error}
          </Text>
        )}
      </BlockStack>,
      <Text as="span" variant="bodySm" key={`${job.id}-time`}>{createdAt}</Text>,
      job.resultUrl && job.status === "completed" ? (
        <Button key={`${job.id}-download`} size="slim" url={job.resultUrl} external>
          下载
        </Button>
      ) : (
        <Text as="span" variant="bodySm" tone="subdued" key={`${job.id}-pending`}>
          等待完成
        </Text>
      ),
    ];
  });

  return (
    <Page title="报告中心" subtitle="导出 PDF/CSV 报告并查看历史记录">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {actionData?.jobId && (
              <Banner tone="success" title="报告任务已创建">
                <Text as="p" variant="bodySm">
                  任务编号：{actionData.jobId}，生成完成后会出现在历史记录中。
                </Text>
              </Banner>
            )}
            {actionData?.error && (
              <Banner tone="critical" title="无法创建报告">
                <Text as="p" variant="bodySm">
                  {actionData.error}
                </Text>
              </Banner>
            )}
            {!gateResult.allowed && (
              <Banner tone="warning" title="报告导出需要升级套餐">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    {gateResult.reason || "报告导出需要 Go-Live 或 Agency 套餐。"}
                  </Text>
                  <Button url="/app/billing" variant="primary" size="slim">
                    查看套餐
                  </Button>
                </BlockStack>
              </Banner>
            )}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">导出报告</Text>
                <BlockStack gap="300">
                  {exportOptions.map((option) => (
                    <Card key={option.type} padding="300">
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{option.title}</Text>
                        <Text as="p" tone="subdued" variant="bodySm">{option.description}</Text>
                        {option.requiresRunId && !latestVerificationRunId && (
                          <Banner tone="warning">
                            <Text as="p" variant="bodySm">
                              暂无可用验收运行记录，请先完成一次验收。
                            </Text>
                          </Banner>
                        )}
                        <InlineStack gap="200">
                          {option.supports.map((format) => (
                            <Form method="post" key={`${option.type}-${format}`}>
                              <input type="hidden" name="_action" value="create_report_job" />
                              <input type="hidden" name="reportType" value={option.type} />
                              <input type="hidden" name="format" value={format} />
                              {option.requiresRunId && latestVerificationRunId && (
                                <input type="hidden" name="runId" value={latestVerificationRunId} />
                              )}
                              <Button
                                submit
                                size="slim"
                                disabled={!gateResult.allowed || isSubmitting || (option.requiresRunId && !latestVerificationRunId)}
                              >
                                导出 {format.toUpperCase()}
                              </Button>
                            </Form>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">导出历史</Text>
                  <Badge tone="info">最近 20 条</Badge>
                </InlineStack>
                {jobs.length === 0 ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    暂无导出记录。
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["报告类型", "格式", "状态", "创建时间", "结果"]}
                    rows={historyRows}
                  />
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
