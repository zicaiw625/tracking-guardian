import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
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
  DataTable,
  Select,
  Banner,
  Modal,
  InlineError,
  Checkbox,
  RangeSlider,
} from "@shopify/polaris";
import {
  SettingsIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  PlusIcon,
  EditIcon,
} from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  checkFeatureAccess,
} from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import {
  getAlertHistory,
  runAlertChecks,
  testThresholds,
  getThresholdRecommendations,
  type AlertCheckResult,
} from "../services/alert-dispatcher.server";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";

interface LoaderData {
  shop: {
    id: string;
    plan: PlanId;
  } | null;
  shopDomain: string;
  alertConfigs: Array<{
    id: string;
    channel: string;
    isEnabled: boolean;
    frequency: string;
    lastAlertAt: Date | null;
  }>;
  alertHistory: Array<{
    id: string;
    alertType: string;
    severity: string;
    message: string;
    triggeredAt: Date;
    resolvedAt: Date | null;
  }>;
  thresholdRecommendations: {
    failureRate: number;
    missingParams: number;
    volumeDrop: number;
    dedupConflict: number;
  };
  canAccessAlerts: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json<LoaderData>({
      shop: null,
      shopDomain,
      alertConfigs: [],
      alertHistory: [],
      thresholdRecommendations: {
        failureRate: 2,
        missingParams: 10,
        volumeDrop: 50,
        dedupConflict: 5,
      },
      canAccessAlerts: false,
    });
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const canAccessAlerts = checkFeatureAccess(planId, "alerts").allowed;

  const alertConfigs = await prisma.alertConfig.findMany({
    where: { shopId: shop.id },
    select: {
      id: true,
      channel: true,
      isEnabled: true,
      frequency: true,
      lastAlertAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const alertHistoryRaw = await getAlertHistory(shop.id, 50);
  const alertHistory = alertHistoryRaw.map(alert => ({
    id: alert.id,
    alertType: alert.alertType,
    severity: alert.severity,
    message: alert.message,
    triggeredAt: alert.createdAt,
    resolvedAt: alert.acknowledged ? alert.createdAt : null,
  }));
  const thresholdRecommendations = await getThresholdRecommendations(shop.id);

  return json<LoaderData>({
    shop: { id: shop.id, plan: planId },
    shopDomain,
    alertConfigs,
    alertHistory,
    thresholdRecommendations,
    canAccessAlerts,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "店铺未找到" }, { status: 404 });
  }

  if (actionType === "test_thresholds") {
    const failureRate = formData.get("failureRate")
      ? parseFloat(formData.get("failureRate") as string)
      : undefined;
    const missingParams = formData.get("missingParams")
      ? parseFloat(formData.get("missingParams") as string)
      : undefined;
    const volumeDrop = formData.get("volumeDrop")
      ? parseFloat(formData.get("volumeDrop") as string)
      : undefined;

    const testResult = await testThresholds(shop.id, {
      failureRate,
      missingParams,
      volumeDrop,
    });

    return json({ success: true, testResult });
  }

  if (actionType === "run_checks") {
    const result = await runAlertChecks(shop.id);
    return json({ success: true, result });
  }

  return json({ error: "无效的操作" }, { status: 400 });
};

export default function AlertsPage() {
  const {
    shop,
    shopDomain,
    alertConfigs,
    alertHistory,
    thresholdRecommendations,
    canAccessAlerts,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  const [showThresholdTest, setShowThresholdTest] = useState(false);
  const [testThresholds, setTestThresholds] = useState({
    failureRate: thresholdRecommendations.failureRate,
    missingParams: thresholdRecommendations.missingParams,
    volumeDrop: thresholdRecommendations.volumeDrop,
  });

  if (!shop) {
    return (
      <Page title="告警管理">
        <Banner tone="critical">店铺未找到</Banner>
      </Page>
    );
  }

  if (!canAccessAlerts) {
    return (
      <Page title="告警管理">
        <UpgradePrompt
          feature="alerts"
          currentPlan={shop.plan}
          tone="info"
        />
      </Page>
    );
  }

  const historyRows = alertHistory.map((alert) => [
    alert.alertType,
    <Badge
      key={alert.id}
      tone={
        alert.severity === "critical"
          ? "critical"
          : alert.severity === "high"
          ? "attention"
          : "info"
      }
    >
      {alert.severity === "critical"
        ? "严重"
        : alert.severity === "high"
        ? "高"
        : alert.severity === "medium"
        ? "中"
        : "低"}
    </Badge>,
    alert.message,
    new Date(alert.triggeredAt).toLocaleString("zh-CN"),
    alert.resolvedAt
      ? new Date(alert.resolvedAt).toLocaleString("zh-CN")
      : "-",
  ]);

  const handleRunChecks = () => {
    const formData = new FormData();
    formData.append("_action", "run_checks");
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="告警管理"
      subtitle="配置监控告警规则，及时发现问题"
      primaryAction={{
        content: "立即检查",
        icon: SettingsIcon,
        onAction: handleRunChecks,
      }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  已配置通道
                </Text>
                <Text as="p" variant="heading2xl">
                  {alertConfigs.length}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {alertConfigs.filter((c) => c.isEnabled).length} 个已启用
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  最近24小时告警
                </Text>
                <Text as="p" variant="heading2xl">
                  {
                    alertHistory.filter(
                      (a) =>
                        Date.now() - new Date(a.triggeredAt).getTime() <
                        24 * 60 * 60 * 1000
                    ).length
                  }
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {alertHistory.filter((a) => !a.resolvedAt).length} 个未解决
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  推荐阈值
                </Text>
                <Button
                  url="/app/settings?tab=alerts"
                  variant="primary"
                  size="medium"
                  fullWidth
                >
                  配置告警规则
                </Button>
                <Button
                  variant="plain"
                  size="slim"
                  onClick={() => setShowThresholdTest(true)}
                >
                  测试阈值
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                告警配置
              </Text>
              <Button url="/app/settings?tab=alerts" icon={PlusIcon}>
                添加配置
              </Button>
            </InlineStack>
            {alertConfigs.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["通道", "状态", "频率", "最后告警", "操作"]}
                rows={alertConfigs.map((config) => [
                  config.channel === "email"
                    ? "邮件"
                    : config.channel === "slack"
                    ? "Slack"
                    : "Telegram",
                  <Badge
                    key={config.id}
                    tone={config.isEnabled ? "success" : undefined}
                  >
                    {config.isEnabled ? "已启用" : "已禁用"}
                  </Badge>,
                  config.frequency === "instant"
                    ? "即时"
                    : config.frequency === "daily"
                    ? "每日"
                    : "每周",
                  config.lastAlertAt
                    ? new Date(config.lastAlertAt).toLocaleString("zh-CN")
                    : "从未",
                  <Button
                    key={`edit-${config.id}`}
                    url={`/app/settings?tab=alerts&configId=${config.id}`}
                    variant="plain"
                    size="slim"
                    icon={EditIcon}
                  >
                    编辑
                  </Button>,
                ])}
              />
            ) : (
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  暂无告警配置，点击"添加配置"开始设置
                </Text>
              </Box>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              告警历史
            </Text>
            {alertHistory.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["类型", "严重程度", "消息", "触发时间", "解决时间"]}
                rows={historyRows}
              />
            ) : (
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  暂无告警历史
                </Text>
              </Box>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
