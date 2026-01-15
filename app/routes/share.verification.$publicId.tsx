import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { createHash, timingSafeEqual } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Divider,
  Banner,
  Layout,
  ProgressBar,
} from "@shopify/polaris";
import { getVerificationRun } from "../services/verification.server";
import { generateVerificationReportData } from "../services/verification-report.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const publicId = params.publicId;
    if (!publicId) {
      throw new Response("Missing publicId", { status: 400 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return json({ error: "Missing share token", report: null }, { status: 403 });
    }

    const run = await prisma.verificationRun.findUnique({
      where: { publicId },
      select: {
        id: true,
        shopId: true,
        publicId: true,
        publicTokenHash: true,
        shareTokenExpiresAt: true,
      },
    });
    
    if (!run) {
      return json({ error: "Report not found", report: null }, { status: 404 });
    }
    
    if (!run.publicTokenHash) {
      return json({ error: "Share link not available", report: null }, { status: 403 });
    }
    
    const shop = await prisma.shop.findUnique({
      where: { id: run.shopId },
      select: { shopDomain: true },
    });
    
    if (!shop) {
      return json({ error: "Shop not found", report: null }, { status: 404 });
    }

    const expectedTokenHash = createHash("sha256")
      .update(`${run.id}-${run.shopId}-${token}`)
      .digest("hex");
    
    const expectedBuffer = Buffer.from(expectedTokenHash, "hex");
    const actualBuffer = Buffer.from(run.publicTokenHash, "hex");
    
    if (expectedBuffer.length !== actualBuffer.length) {
      return json({ error: "Invalid share token", report: null }, { status: 403 });
    }
    
    if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
      return json({ error: "Invalid share token", report: null }, { status: 403 });
    }

    if (run.shareTokenExpiresAt && new Date() > run.shareTokenExpiresAt) {
      return json({ error: "Share link has expired", report: null }, { status: 403 });
    }

    const reportData = await generateVerificationReportData(run.shopId, run.id);
    if (!reportData) {
      return json({ error: "Failed to load report data", report: null }, { status: 500 });
    }

    const headers = new Headers();
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    return json({
      report: {
        runId: reportData.runId,
        runName: reportData.runName,
        shopDomain: reportData.shopDomain,
        runType: reportData.runType,
        status: reportData.status,
        platforms: reportData.platforms,
        totalTests: reportData.summary.totalTests,
        passedTests: reportData.summary.passedTests,
        failedTests: reportData.summary.failedTests,
        missingParamTests: reportData.summary.missingParamTests,
        parameterCompleteness: reportData.summary.parameterCompleteness,
        valueAccuracy: reportData.summary.valueAccuracy,
        platformResults: reportData.platformResults || {},
        startedAt: reportData.startedAt?.toISOString() || null,
        completedAt: reportData.completedAt?.toISOString() || null,
        createdAt: reportData.createdAt.toISOString(),
        events: reportData.events,
        sandboxLimitations: reportData.sandboxLimitations,
      },
    }, { headers });
  } catch (error) {
    logger.error("Failed to load shared verification report", {
      error,
      publicId: params.publicId,
    });
    return json(
      { error: error instanceof Error ? error.message : "Failed to load report", report: null },
      { status: 500 }
    );
  }
};

export default function SharedVerificationReport() {
  const loaderData = useLoaderData<typeof loader>();
  const report = "report" in loaderData ? loaderData.report : null;
  const error = "error" in loaderData ? loaderData.error : null;

  if (error || !report) {
    return (
      <Page title="报告不可用">
        <Card>
          <Banner tone="critical" title="无法访问报告">
            <Text as="p" variant="bodySm">
              {error || "报告不存在或链接已过期"}
            </Text>
          </Banner>
        </Card>
      </Page>
    );
  }

  const passRate =
    report.totalTests > 0 ? Math.round((report.passedTests / report.totalTests) * 100) : 0;

  return (
    <Page title={`验收报告 - ${report.runName}`}>
      <BlockStack gap="500">
        <Banner tone="info" title="这是一个只读的分享报告">
          <Text as="p" variant="bodySm">
            此报告由 {report.shopDomain} 分享，链接将在7天后过期。
          </Text>
        </Banner>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              报告信息
            </Text>
            <Divider />
            <Layout>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    报告名称
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {report.runName}
                  </Text>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    测试类型
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {report.runType === "quick" ? "快速测试" : report.runType === "full" ? "完整测试" : "自定义测试"}
                  </Text>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    状态
                  </Text>
                  <Badge
                    tone={
                      report.status === "completed"
                        ? "success"
                        : report.status === "running"
                          ? "info"
                          : report.status === "failed"
                            ? "critical"
                            : undefined
                    }
                  >
                    {report.status === "completed"
                      ? "已完成"
                      : report.status === "running"
                        ? "进行中"
                        : report.status === "failed"
                          ? "失败"
                          : "待开始"}
                  </Badge>
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
            <Divider />
            <Layout>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {report.totalTests}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      总测试数
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-fill-success-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="success">
                      {report.passedTests}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      通过 ({passRate}%)
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-fill-critical-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="critical">
                      {report.failedTests}
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
                  <Text
                    as="span"
                    variant="headingMd"
                    tone={
                      report.parameterCompleteness >= 90
                        ? "success"
                        : report.parameterCompleteness >= 70
                          ? undefined
                          : "critical"
                    }
                  >
                    {report.parameterCompleteness.toFixed(1)}%
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={report.parameterCompleteness}
                  tone={
                    report.parameterCompleteness >= 90
                      ? "success"
                      : report.parameterCompleteness >= 70
                        ? "highlight"
                        : "critical"
                  }
                />
              </BlockStack>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    金额准确率
                  </Text>
                  <Text
                    as="span"
                    variant="headingMd"
                    tone={
                      report.valueAccuracy >= 95
                        ? "success"
                        : report.valueAccuracy >= 80
                          ? undefined
                          : "critical"
                    }
                  >
                    {report.valueAccuracy.toFixed(1)}%
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={report.valueAccuracy}
                  tone={
                    report.valueAccuracy >= 95
                      ? "success"
                      : report.valueAccuracy >= 80
                        ? "highlight"
                        : "critical"
                  }
                />
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Card>

        {report.platforms.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                测试平台
              </Text>
              <Divider />
              <InlineStack gap="200" wrap>
                {report.platforms.map((platform) => (
                  <Badge key={platform} tone="info">
                    {platform}
                  </Badge>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {Object.keys(report.platformResults || {}).length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                平台统计
              </Text>
              <Divider />
              <BlockStack gap="300">
                {Object.entries(report.platformResults || {}).map(([platform, stats]) => {
                  const total = stats.sent + stats.failed;
                  const successRate = total > 0 ? Math.round((stats.sent / total) * 100) : 0;
                  return (
                    <Box key={platform} background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {platform}
                          </Text>
                          <Badge tone={successRate >= 90 ? "success" : successRate >= 70 ? undefined : "critical"}>
                            {`${successRate}% 成功率`}
                          </Badge>
                        </InlineStack>
                        <InlineStack gap="400">
                          <Text as="span" variant="bodySm">
                            成功: {stats.sent.toString()}
                          </Text>
                          <Text as="span" variant="bodySm">
                            失败: {stats.failed.toString()}
                          </Text>
                          <Text as="span" variant="bodySm">
                            总计: {total.toString()}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Card>
        )}
        {"sandboxLimitations" in report && report.sandboxLimitations && (
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
              {report.sandboxLimitations.missingFields && report.sandboxLimitations.missingFields.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    缺失字段（由于 strict sandbox 限制，已自动标注）
                  </Text>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      以下字段因 strict sandbox 限制而无法获取，这是平台限制，不是故障。报告中已自动标注这些限制。哪些事件/哪些字段拿不到已在报告中自动标注，减少纠纷。
                    </Text>
                  </Banner>
                  {report.sandboxLimitations.missingFields.map((item: { eventType: string; fields: string[]; reason: string }, index: number) => (
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
              {report.sandboxLimitations.unavailableEvents && report.sandboxLimitations.unavailableEvents.length > 0 && (
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
                      {report.sandboxLimitations.unavailableEvents.join(", ")}
                    </Text>
                  </Box>
                </BlockStack>
              )}
              {report.sandboxLimitations.notes && report.sandboxLimitations.notes.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    自动标注说明
                  </Text>
                  <Banner tone="info">
                    <BlockStack gap="200">
                      {report.sandboxLimitations.notes.map((note: string, index: number) => (
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
      </BlockStack>
    </Page>
  );
}
