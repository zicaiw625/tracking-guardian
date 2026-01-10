import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { createHash } from "crypto";
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

    if (run.publicTokenHash !== expectedTokenHash) {
      return json({ error: "Invalid share token", report: null }, { status: 403 });
    }

    if (run.shareTokenExpiresAt && new Date() > run.shareTokenExpiresAt) {
      return json({ error: "Share link has expired", report: null }, { status: 403 });
    }

    const verificationSummary = await getVerificationRun(run.id);
    if (!verificationSummary) {
      return json({ error: "Failed to load report data", report: null }, { status: 500 });
    }

    const createdAt = await prisma.verificationRun.findUnique({
      where: { id: run.id },
      select: { createdAt: true },
    });

    return json({
      report: {
        runId: verificationSummary.runId,
        runName: verificationSummary.runName,
        shopDomain: shop.shopDomain,
        runType: verificationSummary.runType,
        status: verificationSummary.status,
        platforms: verificationSummary.platforms,
        totalTests: verificationSummary.totalTests,
        passedTests: verificationSummary.passedTests,
        failedTests: verificationSummary.failedTests,
        missingParamTests: verificationSummary.missingParamTests,
        parameterCompleteness: verificationSummary.parameterCompleteness,
        valueAccuracy: verificationSummary.valueAccuracy,
        platformResults: verificationSummary.platformResults || {},
        startedAt: verificationSummary.startedAt?.toISOString() || null,
        completedAt: verificationSummary.completedAt?.toISOString() || null,
        createdAt: createdAt?.createdAt.toISOString() || new Date().toISOString(),
      },
    });
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

        {Object.keys(report.platformResults).length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                平台统计
              </Text>
              <Divider />
              <BlockStack gap="300">
                {Object.entries(report.platformResults).map(([platform, stats]) => {
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
      </BlockStack>
    </Page>
  );
}
