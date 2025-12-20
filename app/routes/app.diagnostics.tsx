/**
 * P3-1: Diagnostics Wizard
 * 
 * This page provides a quick health check for App Store reviewers and merchants
 * to verify the app is configured correctly.
 * 
 * Checks:
 * 1. Pixel activation status
 * 2. Ingestion secret configuration
 * 3. Last event received
 * 4. CAPI platform configuration
 * 5. Recent conversion status
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  ProgressBar,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getExistingWebPixels } from "../services/migration.server";

interface DiagnosticCheck {
  name: string;
  status: "pass" | "fail" | "warning" | "pending";
  message: string;
  details?: string;
}

interface DiagnosticsData {
  checks: DiagnosticCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  lastUpdated: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const checks: DiagnosticCheck[] = [];

  // Get shop data
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      ingestionSecret: true,
      piiEnabled: true,
      consentStrategy: true,
      dataRetentionDays: true,
      pixelConfigs: {
        where: { isActive: true },
        select: {
          platform: true,
          serverSideEnabled: true,
          credentialsEncrypted: true,
        },
      },
    },
  });

  if (!shop) {
    return json({
      checks: [
        {
          name: "Shop 配置",
          status: "fail" as const,
          message: "未找到店铺配置",
          details: "请重新安装应用",
        },
      ],
      summary: { total: 1, passed: 0, failed: 1, warnings: 0 },
      lastUpdated: new Date().toISOString(),
    });
  }

  // Check 1: Ingestion Key (used for request correlation and noise filtering)
  checks.push({
    name: "Ingestion Key",
    status: shop.ingestionSecret ? "pass" : "fail",
    message: shop.ingestionSecret
      ? "已配置 Ingestion Key"
      : "Ingestion Key 未配置",
    details: shop.ingestionSecret
      ? "像素事件关联与过滤已启用"
      : "请在设置页面生成 Ingestion Key",
  });

  // Check 2: Web Pixel Status
  // Our App Pixel is identified by having an ingestion_secret setting
  try {
    const existingPixels = await getExistingWebPixels(admin);
    const ourPixel = existingPixels.find((p) => {
      try {
        const settings = JSON.parse(p.settings || "{}");
        // Our App Pixel is identified by having an ingestion_secret setting
        return typeof settings.ingestion_secret === "string";
      } catch {
        return false;
      }
    });

    checks.push({
      name: "Web Pixel",
      status: ourPixel ? "pass" : "warning",
      message: ourPixel ? "Web Pixel 已安装" : "Web Pixel 未安装",
      details: ourPixel
        ? `Pixel ID: ${ourPixel.id}`
        : "请在迁移页面安装 Web Pixel",
    });
  } catch (error) {
    checks.push({
      name: "Web Pixel",
      status: "warning",
      message: "无法检查 Web Pixel 状态",
      details: "请手动检查 Web Pixel 配置",
    });
  }

  // Check 3: Platform Configuration
  const serverSideConfigs = shop.pixelConfigs.filter(c => c.serverSideEnabled);
  
  if (serverSideConfigs.length > 0) {
    checks.push({
      name: "服务端追踪 (CAPI)",
      status: "pass",
      message: `已配置 ${serverSideConfigs.length} 个平台`,
      details: serverSideConfigs.map(c => c.platform).join(", "),
    });
  } else {
    checks.push({
      name: "服务端追踪 (CAPI)",
      status: "warning",
      message: "未启用服务端追踪",
      details: "启用 CAPI 可提高追踪准确性",
    });
  }

  // Check 4: Recent Events
  const recentReceipt = await prisma.pixelEventReceipt.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      eventType: true,
      signatureStatus: true,
    },
  });

  if (recentReceipt) {
    const hoursSinceLastEvent = Math.round(
      (Date.now() - recentReceipt.createdAt.getTime()) / (1000 * 60 * 60)
    );
    
    checks.push({
      name: "最近事件",
      status: hoursSinceLastEvent < 24 ? "pass" : "warning",
      message: recentReceipt
        ? `${hoursSinceLastEvent} 小时前收到事件`
        : "尚未收到事件",
      details: recentReceipt
        ? `类型: ${recentReceipt.eventType}, 签名: ${recentReceipt.signatureStatus}`
        : "完成测试订单后会收到事件",
    });
  } else {
    checks.push({
      name: "最近事件",
      status: "pending",
      message: "尚未收到任何事件",
      details: "完成一个测试订单以验证追踪功能",
    });
  }

  // Check 5: Recent Conversions
  const recentConversions = await prisma.conversionLog.count({
    where: {
      shopId: shop.id,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });

  checks.push({
    name: "24h 转化记录",
    status: recentConversions > 0 ? "pass" : "pending",
    message: `${recentConversions} 条转化记录`,
    details: recentConversions > 0
      ? "转化追踪正常运行"
      : "完成测试订单后会产生转化记录",
  });

  // Check 6: Consent Strategy
  checks.push({
    name: "Consent 策略",
    status: "pass",
    message: `当前策略: ${shop.consentStrategy || "balanced"}`,
    details: shop.consentStrategy === "strict"
      ? "严格模式: 需要明确用户同意"
      : shop.consentStrategy === "weak"
      ? "宽松模式: 默示同意"
      : "平衡模式: 推荐设置",
  });

  // Check 7: Data Retention
  checks.push({
    name: "数据保留策略",
    status: "pass",
    message: `保留期: ${shop.dataRetentionDays} 天`,
    details: "超期数据自动清理",
  });

  // Calculate summary
  const summary = {
    total: checks.length,
    passed: checks.filter(c => c.status === "pass").length,
    failed: checks.filter(c => c.status === "fail").length,
    warnings: checks.filter(c => c.status === "warning").length,
  };

  return json({
    checks,
    summary,
    lastUpdated: new Date().toISOString(),
  });
};

export default function DiagnosticsPage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const getStatusBadge = (status: DiagnosticCheck["status"]) => {
    switch (status) {
      case "pass":
        return <Badge tone="success">通过</Badge>;
      case "fail":
        return <Badge tone="critical">失败</Badge>;
      case "warning":
        return <Badge tone="warning">警告</Badge>;
      case "pending":
        return <Badge tone="info">待验证</Badge>;
    }
  };

  const overallStatus = data.summary.failed > 0
    ? "critical"
    : data.summary.warnings > 0
    ? "warning"
    : "success";

  const progressPercent = Math.round(
    (data.summary.passed / data.summary.total) * 100
  );

  return (
    <Page
      title="诊断向导"
      subtitle="快速检查应用配置状态"
      primaryAction={{
        content: "刷新检查",
        onAction: () => revalidator.revalidate(),
        loading: revalidator.state === "loading",
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  整体状态
                </Text>
                <Badge tone={overallStatus}>
                  {overallStatus === "success"
                    ? "正常"
                    : overallStatus === "warning"
                    ? "需要注意"
                    : "需要处理"}
                </Badge>
              </InlineStack>

              <ProgressBar progress={progressPercent} tone={overallStatus} />

              <InlineStack gap="400">
                <Text as="span" variant="bodySm" tone="subdued">
                  通过: {data.summary.passed}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  警告: {data.summary.warnings}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  失败: {data.summary.failed}
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                检查项
              </Text>

              <Divider />

              {data.checks.map((check, index) => (
                <Box key={index} paddingBlockEnd="400">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {check.name}
                      </Text>
                      {getStatusBadge(check.status)}
                    </InlineStack>
                    <Text as="p" variant="bodyMd">
                      {check.message}
                    </Text>
                    {check.details && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {check.details}
                      </Text>
                    )}
                  </BlockStack>
                  {index < data.checks.length - 1 && (
                    <Box paddingBlockStart="400">
                      <Divider />
                    </Box>
                  )}
                </Box>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Banner title="审核人员提示" tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                如需验证完整功能，请按以下步骤操作：
              </Text>
              <Text as="p" variant="bodySm">
                1. 确保所有检查项为「通过」或「待验证」
                <br />
                2. 完成一个测试订单
                <br />
                3. 刷新此页面，确认「最近事件」变为「通过」
                <br />
                4. 查看「监控」页面确认数据正确显示
              </Text>
            </BlockStack>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Text as="p" variant="bodySm" tone="subdued">
            最后更新: {new Date(data.lastUpdated).toLocaleString("zh-CN")}
          </Text>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

