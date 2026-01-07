import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Box, Divider, DataTable, Select, ProgressBar, Button, Icon, Link, Banner, List } from "@shopify/polaris";
import { SettingsIcon, SearchIcon, RefreshIcon, ArrowRightIcon, AlertCircleIcon, CheckCircleIcon, } from "~/components/icons";
import { TableSkeleton, EnhancedEmptyState, useToastContext, CardSkeleton } from "~/components/ui";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { runDiagnostics } from "~/services/monitoring-diagnostics.server";
import { useState, Suspense, lazy } from "react";

const MissingParamsChart = lazy(() => import("~/components/monitor/MissingParamsChart").then(module => ({ default: module.MissingParamsChart })));
const MissingParamsDetails = lazy(() => import("~/components/monitor/MissingParamsDetails").then(module => ({ default: module.MissingParamsDetails })));
const EventVolumeChart = lazy(() => import("~/components/monitor/EventVolumeChart").then(module => ({ default: module.EventVolumeChart })));
const RealtimeEventMonitor = lazy(() => import("~/components/monitor/RealtimeEventMonitor").then(module => ({ default: module.RealtimeEventMonitor })));
const AlertHistoryChart = lazy(() => import("~/components/monitor/AlertHistoryChart").then(module => ({ default: module.AlertHistoryChart })));
const SuccessRateChart = lazy(() => import("~/components/monitor/SuccessRateChart").then(module => ({ default: module.SuccessRateChart })));
const DiagnosticsPanel = lazy(() => import("~/components/monitor/DiagnosticsPanel").then(module => ({ default: module.DiagnosticsPanel })));
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getDeliveryHealthHistory, getDeliveryHealthSummary, type DeliveryHealthReport, } from "../services/delivery-health.server";
import { getAlertHistory, runAlertChecks, type AlertCheckResult } from "../services/alert-dispatcher.server";
import { isValidPlatform, PLATFORM_NAMES } from "../types";
import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats, getEventVolumeHistory, checkMonitoringAlerts, getMissingParamsHistory, reconcileChannels, getMissingParamsRateByEventType, type EventMonitoringStats, type EventVolumeStats, type ChannelReconciliationResult } from "../services/monitoring.server";
import { getEventSuccessRateHistory } from "../services/monitoring/event-success-rate.server";
import { analyzeDedupConflicts } from "../services/capi-dedup.server";
import { getMissingParamsRate } from "../services/event-validation.server";
import { checkFeatureAccess } from "../services/billing/feature-gates.server";
import { normalizePlanId } from "../services/billing/plans";
import { normalizePlan } from "../utils/plans";
import { trackEvent } from "../services/analytics.server";
import { safeFireAndForget } from "../utils/helpers";
interface DeliverySummary {
    platform: string;
    last7DaysAttempted: number;
    last7DaysSent: number;
    avgSuccessRate: number;
    topFailureReasons: Array<{
        reason: string;
        count: number;
    }>;
}
interface ConversionStat {
    platform: string;
    status: string;
    _count: number;
    _sum: {
        orderValue: number | null;
    };
}
interface ProcessedStat {
    total: number;
    sent: number;
    failed: number;
    revenue: number;
}
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
    });
    if (!shop) {
        return json({
            shop: null,
            summary: {},
            history: [],
            conversionStats: null,
            configHealth: {
                appUrl: process.env.SHOPIFY_APP_URL || "",
                lastPixelOrigin: latestEventLog?.source || null,
                lastPixelTime: latestEventLog?.createdAt.toISOString() || null
            },
            lastUpdated: new Date().toISOString(),
            monitoringStats: null,
            missingParamsStats: [],
            volumeStats: null,
            monitoringAlert: null,
            missingParamsDetailed: null,
        });
    }
    const planId = normalizePlan(shop.plan ?? "free");
    const planIdNormalized = normalizePlanId(shop.plan ?? "free");

        let livePixelEnabled24hAgo = false;
    try {
        const livePixelConfigs = await prisma.pixelConfig.findMany({
            where: {
                shopId: shop.id,
                environment: "live",
                isActive: true,
            },
            select: {
                updatedAt: true,
            },
            orderBy: {
                updatedAt: "asc",
            },
            take: 1,
        });

        if (livePixelConfigs.length > 0) {
            const oldestLiveSwitch = livePixelConfigs[0].updatedAt;
            const hoursSinceLiveSwitch = (Date.now() - oldestLiveSwitch.getTime()) / (1000 * 60 * 60);
            livePixelEnabled24hAgo = hoursSinceLiveSwitch >= 24;
        }
    } catch (error) {
        logger.warn("Failed to check live pixel 24h status", { shopId: shop.id, error });
    }

        const monitoringGate = checkFeatureAccess(planIdNormalized, "alerts");
        const shouldShowPaywall = !monitoringGate.allowed || !livePixelEnabled24hAgo;

    if (shouldShowPaywall) {
        safeFireAndForget(
                        trackEvent({
                shopId: shop.id,
                shopDomain,
                event: "app_paywall_viewed",
                metadata: {
                    triggerPage: "monitoring",
                    plan: shop.plan ?? "free",
                    livePixelEnabled24hAgo,
                },
            })
        );
    }
    const summary = await getDeliveryHealthSummary(shop.id);

    const history = await getDeliveryHealthHistory(shop.id, 1);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);

    const deliveryAttempts = await prisma.deliveryAttempt.findMany({
        where: {
            shopId: shop.id,
            createdAt: { gte: sevenDaysAgo },
        },
        select: {
            destinationType: true,
            status: true,
        },
    });

    const conversionStats = deliveryAttempts.reduce((acc, attempt) => {
        const key = `${attempt.destinationType}:${attempt.status}`;
        if (!acc[key]) {
            acc[key] = { platform: attempt.destinationType, status: attempt.status, _count: 0, _sum: { orderValue: 0 } };
        }
        acc[key]._count++;
        return acc;
    }, {} as Record<string, { platform: string; status: string; _count: number; _sum: { orderValue: number } }>);

    const appUrl = process.env.SHOPIFY_APP_URL || "";

    const latestEventLog = await prisma.eventLog.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        select: {
            source: true,
            createdAt: true
        }
    });

    const alertConfigs = await prisma.alertConfig.findMany({
        where: { shopId: shop.id, isEnabled: true },
        select: { id: true, channel: true, frequency: true },
    });

    const recentAlerts = await getAlertHistory(shop.id, 10);

    let currentAlertStatus: AlertCheckResult[] = [];
    try {
        const checkResult = await runAlertChecks(shop.id);
        currentAlertStatus = checkResult.results.filter(r => r.triggered);
    } catch (error) {
        logger.error("Failed to run alert checks", {
            shopId: shop.id,
            error: error instanceof Error ? error.message : String(error),
        });

    }

    const last24h = new Date();
    last24h.setHours(last24h.getHours() - 24);

    const [monitoringStats, missingParamsStats, volumeStats, monitoringAlert, missingParamsHistory, eventVolumeHistory, channelReconciliation, dedupAnalysis, missingParamsDetailed, successRateHistory, diagnosticsReport] = await Promise.all([
        getEventMonitoringStats(shop.id, 24),
        getMissingParamsStats(shop.id, 24),
        getEventVolumeStats(shop.id),
        checkMonitoringAlerts(shop.id).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.warn("Failed to check monitoring alerts", {
                shopId: shop.id,
                error: errorMessage,
                errorName: error instanceof Error ? error.name : "Unknown",
                errorStack,
            });
            return null;
        }),
        getMissingParamsHistory(shop.id, 7).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.warn("Failed to get missing params history", {
                shopId: shop.id,
                error: errorMessage,
                errorName: error instanceof Error ? error.name : "Unknown",
                errorStack,
            });
            return [];
        }),
        getEventVolumeHistory(shop.id, 7).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.warn("Failed to get event volume history", {
                shopId: shop.id,
                error: errorMessage,
                errorName: error instanceof Error ? error.name : "Unknown",
                errorStack,
            });
            return [];
        }),
        reconcileChannels(shop.id, 24).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.warn("Failed to reconcile channels", {
                shopId: shop.id,
                error: errorMessage,
                errorName: error instanceof Error ? error.name : "Unknown",
                errorStack,
            });
            return [];
        }),
        analyzeDedupConflicts(shop.id, last24h, new Date()).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.warn("Failed to analyze dedup conflicts", {
                shopId: shop.id,
                error: errorMessage,
                errorName: error instanceof Error ? error.name : "Unknown",
                errorStack,
            });
            return null;
        }),
        getMissingParamsRateByEventType(shop.id, 24).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.warn("Failed to get missing params rate by event type", {
                shopId: shop.id,
                error: errorMessage,
                errorName: error instanceof Error ? error.name : "Unknown",
                errorStack,
            });
            return null;
        }),
        getEventSuccessRateHistory(shop.id, 24).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.warn("Failed to get event success rate history", {
                shopId: shop.id,
                error: errorMessage,
                errorName: error instanceof Error ? error.name : "Unknown",
                errorStack,
            });
            return { overall: [], byDestination: {}, byEventType: {} };
        }),
        runDiagnostics(shop.id).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.warn("Failed to run diagnostics", {
                shopId: shop.id,
                error: errorMessage,
                errorName: error instanceof Error ? error.name : "Unknown",
                errorStack,
            });
            return null;
        }),
    ]);

    return json({
        shop: { id: shop.id, domain: shopDomain },
        planId,
        monitoringGate,
        summary,
        history,
        conversionStats: Object.values(conversionStats).map(stat => ({
            platform: stat.platform,
            status: stat.status,
            _count: stat._count,
            _sum: { orderValue: stat._sum.orderValue },
        })),
        configHealth: {
            appUrl,
            lastPixelOrigin: latestEventLog?.source || null,
            lastPixelTime: latestEventLog?.createdAt ? latestEventLog.createdAt.toISOString() : null
        },
        alertConfigs: alertConfigs.length > 0,
        alertCount: alertConfigs.length,
        recentAlerts,
        currentAlertStatus,
        monitoringStats,
        missingParamsStats,
        volumeStats,
        monitoringAlert,
        missingParamsHistory,
        eventVolumeHistory,
        channelReconciliation,
        dedupAnalysis,
        missingParamsDetailed,
        successRateHistory,
        diagnosticsReport,
        lastUpdated: new Date().toISOString(),
        livePixelEnabled24hAgo,
        shouldShowPaywall,
    });
};
export default function MonitorPage() {
  const loaderData = useLoaderData<typeof loader>();

  const { summary, history, conversionStats, configHealth, monitoringStats, missingParamsStats, volumeStats, monitoringAlert, missingParamsDetailed, lastUpdated, shop } = loaderData;
  const planId = "planId" in loaderData ? loaderData.planId : "free";
  const monitoringGate = "monitoringGate" in loaderData ? loaderData.monitoringGate : null;
  const livePixelEnabled24hAgo = "livePixelEnabled24hAgo" in loaderData ? loaderData.livePixelEnabled24hAgo : false;
  const shouldShowPaywall = "shouldShowPaywall" in loaderData ? loaderData.shouldShowPaywall : false;
  const alertConfigs = "alertConfigs" in loaderData ? loaderData.alertConfigs : false;
  const alertCount = "alertCount" in loaderData ? loaderData.alertCount : 0;
  const recentAlerts = "recentAlerts" in loaderData ? loaderData.recentAlerts : [];
  const currentAlertStatus = "currentAlertStatus" in loaderData ? loaderData.currentAlertStatus : [];
  const missingParamsHistory = "missingParamsHistory" in loaderData ? loaderData.missingParamsHistory : [];
  const eventVolumeHistory = "eventVolumeHistory" in loaderData ? loaderData.eventVolumeHistory : [];
  const channelReconciliation = "channelReconciliation" in loaderData ? loaderData.channelReconciliation : [];
  const dedupAnalysis = "dedupAnalysis" in loaderData ? loaderData.dedupAnalysis : null;
  const successRateHistory = "successRateHistory" in loaderData ? loaderData.successRateHistory : { overall: [], byDestination: {}, byEventType: {} };
  const diagnosticsReport = "diagnosticsReport" in loaderData ? loaderData.diagnosticsReport : null;
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedChartPlatform, setSelectedChartPlatform] = useState<string>("all");
  const [missingParamsTimeRange, setMissingParamsTimeRange] = useState<string>("24");
  const [selectedSuccessRateDestination, setSelectedSuccessRateDestination] = useState<string>("all");
  const [selectedSuccessRateEventType, setSelectedSuccessRateEventType] = useState<string>("all");
  const [alertHistoryTimeRange, setAlertHistoryTimeRange] = useState<"7d" | "30d" | "90d">("30d");

    const isDevUrl = configHealth.appUrl && (configHealth.appUrl.includes("ngrok") || configHealth.appUrl.includes("trycloudflare"));

  const lastHeartbeat = configHealth.lastPixelTime ? (() => {
    try {
      const date = new Date(configHealth.lastPixelTime);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  })() : null;
  const isHeartbeatStale = lastHeartbeat ? (new Date(lastUpdated).getTime() - lastHeartbeat.getTime() > 24 * 60 * 60 * 1000) : true;

  const heartbeatTone: "success" | "warning" | "critical" = (() => {
    if (!lastHeartbeat) return "critical";
    if (isHeartbeatStale) return "warning";
    return "success";
  })();

  const heartbeatLabel = (() => {
    if (!lastHeartbeat) return "未收到像素心跳";
    const diffMs = new Date(lastUpdated).getTime() - lastHeartbeat.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return "< 1 小时前";
    if (diffHours < 24) return `${diffHours} 小时前`;
    const diffDays = Math.ceil(diffHours / 24);
    return `${diffDays} 天前`;
  })();

  const heartbeatDescription = (() => {
    if (!lastHeartbeat) {
      return "尚未收到任何像素请求，请先在测试店铺下单并确认 Web Pixel 已安装。";
    }
    if (isHeartbeatStale) {
      return "超过 24 小时未收到新的像素请求，建议执行一次测试订单或检查域名配置。";
    }
    return "最近已收到像素心跳，可继续执行事件参数对账或多渠道验证。";
  })();

  const originHost = configHealth.lastPixelOrigin || "未记录";
  const isOriginDevHost = originHost.includes("ngrok") || originHost.includes("trycloudflare") || originHost.includes("localhost");
  const environmentWarning = isOriginDevHost && configHealth.appUrl && !configHealth.appUrl.includes("ngrok") && !configHealth.appUrl.includes("trycloudflare")
    ? "像素来自开发隧道域名，而应用 URL 指向生产。请确认 Pixel 使用的 backend_url 是否为生产域名。"
    : null;

    function isDeliverySummary(value: unknown): value is DeliverySummary {
      if (typeof value !== "object" || value === null) return false;
      const v = value as Record<string, unknown>;
      return (
        typeof v.platform === "string" &&
        typeof v.last7DaysAttempted === "number" &&
        typeof v.last7DaysSent === "number" &&
        typeof v.avgSuccessRate === "number" &&
        Array.isArray(v.topFailureReasons) &&
        v.topFailureReasons.every((item: unknown) => {
          if (typeof item !== "object" || item === null) return false;
          const i = item as Record<string, unknown>;
          return typeof i.reason === "string" && typeof i.count === "number";
        })
      );
    }

    function isDeliverySummaryRecord(value: unknown): value is Record<string, DeliverySummary> {
      if (typeof value !== "object" || value === null) return false;
      return Object.values(value).every(isDeliverySummary);
    }

    const summaryData: Record<string, DeliverySummary> = isDeliverySummaryRecord(summary) ? summary : {};

    const historyData: DeliveryHealthReport[] = (history ?? []).map((h) => {
      if (!h || typeof h !== "object") {
        return {
          id: "",
          platform: "",
          reportDate: new Date(),
          shopifyOrders: 0,
          platformConversions: 0,
          orderDiscrepancy: 0,
          alertSent: false,
        };
      }
      const reportDateValue = (h as Record<string, unknown>).reportDate;
      const reportDate = reportDateValue instanceof Date
        ? reportDateValue
        : typeof reportDateValue === 'string'
          ? new Date(reportDateValue)
          : new Date();

      return {
        id: h.id,
        platform: h.platform,
        reportDate,
        shopifyOrders: h.shopifyOrders,
        platformConversions: h.platformConversions,
        orderDiscrepancy: h.orderDiscrepancy,
        alertSent: h.alertSent,
      };
    });

    function isConversionStat(value: unknown): value is ConversionStat {
      if (typeof value !== "object" || value === null) return false;
      const v = value as Record<string, unknown>;
      return (
        typeof v.platform === "string" &&
        typeof v.status === "string" &&
        typeof v._count === "number" &&
        typeof v._sum === "object" &&
        v._sum !== null &&
        (typeof (v._sum as Record<string, unknown>).orderValue === "number" ||
         (v._sum as Record<string, unknown>).orderValue === null)
      );
    }

    function isConversionStatArray(value: unknown): value is ConversionStat[] {
      return Array.isArray(value) && value.every(isConversionStat);
    }

    const statsData: ConversionStat[] | null = isConversionStatArray(conversionStats) ? conversionStats : null;
    const alertSeveritySummary = currentAlertStatus.reduce<Record<string, number>>((acc, alert) => {
        const key = alert.severity || "medium";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    const alertSummaryTone = currentAlertStatus.length > 0 ? "critical" : "success";
    const alertSummaryText = currentAlertStatus.length > 0
        ? `当前有 ${currentAlertStatus.length} 个告警需要关注`
        : "当前未检测到异常告警";
    const calculateHealthScore = (): number | null => {
        const platforms = Object.keys(summaryData);
        if (platforms.length === 0)
            return null;
        const avgSuccessRate = platforms.reduce((sum, p) => sum + (summaryData[p]?.avgSuccessRate || 0), 0) / platforms.length;
        if (avgSuccessRate < 0.8)
            return 40;
        if (avgSuccessRate < 0.9)
            return 70;
        if (avgSuccessRate < 0.95)
            return 85;
        return 95;
    };
    const healthScore = calculateHealthScore();
    const hasData = Object.keys(summaryData).length > 0;
    const filteredHistory = selectedPlatform === "all"
        ? historyData
        : historyData.filter((h) => h.platform === selectedPlatform);
    const processedStats = statsData?.reduce<Record<string, ProcessedStat>>((acc, stat) => {
        if (!acc[stat.platform]) {
            acc[stat.platform] = { total: 0, sent: 0, failed: 0, revenue: 0 };
        }
        acc[stat.platform].total += stat._count;
        if (stat.status === "sent") {
            acc[stat.platform].sent += stat._count;
            acc[stat.platform].revenue += Number(stat._sum?.orderValue || 0);
        }
        else if (stat.status === "failed") {
            acc[stat.platform].failed += stat._count;
        }
        return acc;
    }, {});
    const platformOptions = [
        { label: "所有平台", value: "all" },
        ...Object.keys(summaryData).map((p) => ({
            label: isValidPlatform(p) ? PLATFORM_NAMES[p] : p,
            value: p,
        })),
    ];
    return (<Page title="监控面板" subtitle="追踪健康状况和转化发送成功率报告" primaryAction={{
            content: "配置追踪平台",
            url: "/app/migrate",
        }} secondaryActions={[
            {
                content: "告警中心",
                url: "/app/alerts",
            },
            {
                content: "运行诊断",
                url: "/app/diagnostics",
            }
        ]}>
      <BlockStack gap="500">
        <PageIntroCard
          title="上线监控总览"
          description="持续跟踪事件成功率、失败率与缺参率，异常波动自动提醒。"
          items={[
            "查看目的地发送成功率与延迟",
            "下载失败明细与 payload",
            "告警配置在设置页统一管理",
          ]}
          primaryAction={{ content: "配置告警", url: "/app/settings?tab=alerts" }}
          secondaryAction={{ content: "导出报告", url: "/app/reports" }}
        />
        {}
        {(() => {
          const piiRegulationDate = new Date("2025-12-10");
          const now = new Date();
          const isAfterRegulationDate = now >= piiRegulationDate;

          if (!isAfterRegulationDate) {
            return null;
          }

          return (
            <Banner tone="warning" title="⚠️ 隐私/PII 新规说明（2025-12-10 起生效）">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm">
                  <strong>重要提示：</strong>从 2025-12-10 起，未获批 protected scopes 的应用，web pixel payload 里的 PII 字段会是 <code>null</code>（仍会收到事件）。
                </Text>
                <Divider />
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  PII 字段为 null 的归因逻辑：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>隐私过滤/同意状态：</strong>如果 <code>email</code>、<code>phone</code>、<code>name</code>、<code>address</code> 等 PII 字段为 <code>null</code>，这通常是由于：
                      <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
                        <li>应用的 protected customer data 权限未获批</li>
                        <li>客户的隐私同意状态（analytics/marketing/saleOfData）未满足要求</li>
                        <li>平台特定的隐私要求（如 Meta/TikTok 需要 marketing + saleOfData 同意）</li>
                      </ul>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>真实故障：</strong>如果 <code>value</code>、<code>currency</code>、<code>event_id</code> 等业务字段为 <code>null</code>，这通常是真正的发送故障，需要检查配置。
                    </Text>
                  </List.Item>
                </List>
                <Divider />
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  如何区分：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>PII 字段（email/phone/name/address）为 null：</strong>归因到"隐私过滤/同意状态"，<strong>不是故障</strong>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>业务字段（value/currency/event_id）为 null：</strong>归因到"真实故障"，需要检查配置
                    </Text>
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued">
                  💡 <strong>提示：</strong>即使 PII 字段为 <code>null</code>，事件仍会正常发送到平台，平台会根据其算法进行归因。这不会影响事件发送，只是部分 PII 字段会被过滤。
                </Text>
              </BlockStack>
            </Banner>
          );
        })()}

        {shouldShowPaywall && (
          <UpgradePrompt
            feature="alerts"
            currentPlan={planId}
            gateResult={monitoringGate}
            tone="warning"
          />
        )}
        {!livePixelEnabled24hAgo && (
          <Banner tone="info" title="Live 切换后 24 小时解锁">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                <strong>PRD 3 转化节点3：</strong>Live 切换后 24 小时才解锁 Monitoring + 告警功能。
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                这是为了确保您有足够的数据进行监控分析。请等待 24 小时后再访问此页面。
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  告警中心入口
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {alertSummaryText}
                </Text>
              </BlockStack>
              <Badge tone={alertSummaryTone}>
                {currentAlertStatus.length > 0 ? `${currentAlertStatus.length} 个告警` : "正常"}
              </Badge>
            </InlineStack>
            <InlineStack gap="200" wrap>
              <Button url="/app/alerts" variant="primary" size="slim">
                查看告警中心
              </Button>
              <Button url="/app/settings?tab=alerts" variant="secondary" size="slim">
                配置告警渠道
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Banner tone="info" title="像素隐私与同意过滤说明">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              <strong>像素加载策略与后端过滤逻辑：</strong>
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>像素加载条件：</strong>Web Pixel 在用户同意 <strong>analytics</strong> 时加载（符合 Shopify Pixel Privacy 规范）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>后端过滤策略：</strong>
                  <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
                    <li><strong>GA4：</strong>只需 analytics 同意即可发送（analytics 类别）</li>
                    <li><strong>Meta/TikTok：</strong>需要 marketing + saleOfData 同意才发送（marketing 类别，需要 CCPA 同意）</li>
                  </ul>
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>为什么这样设计：</strong>这确保了 analytics 同意的用户也能被 GA4 追踪，同时 marketing 平台（Meta/TikTok）仍受严格检查，符合各平台的合规要求。
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>如果事件被过滤：</strong>当用户只同意 analytics 但不同意 marketing 时，GA4 事件仍会发送，但 Meta/TikTok 事件会在后端被过滤。这是正常的合规行为，不会影响 GA4 追踪。
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              参考：<Link url="https://shopify.dev/docs/api/web-pixels-api/pixel-privacy" external>Shopify Pixel Privacy 文档</Link>
            </Text>
          </BlockStack>
        </Banner>

        {}
        {(() => {
          const piiRegulationDate = new Date("2025-12-10");
          const now = new Date();
          const isAfterRegulationDate = now >= piiRegulationDate;

          if (!isAfterRegulationDate) {
            return null;
          }

          return (
            <Banner tone="warning" title="⚠️ 隐私/PII 新规说明（2025-12-10 起生效）">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  <strong>从 2025-12-10 起：</strong>未获批 protected scopes 的 app，web pixel payload 里的 PII 字段会是 <code>null</code>（仍会收到事件）。
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>PII 字段为 null 的处理：</strong>监控里会把它归因到"隐私过滤/同意状态"，避免误报为"故障"。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>事件仍会正常接收：</strong>即使 PII 字段为 <code>null</code>，事件本身仍会正常发送和接收，只是不包含客户个人信息。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>如何区分：</strong>
                      <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
                        <li><strong>PII 字段（email/phone/name/address）为 null：</strong>归因到"隐私过滤/同意状态"，不是故障</li>
                        <li><strong>业务字段（value/currency/event_id）为 null：</strong>归因到"真实故障"，需要检查配置</li>
                      </ul>
                    </Text>
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued">
                  参考：<Link url="https://shopify.dev/docs/apps/store/data-protection/protected-customer-data" external>Shopify Protected Customer Data 文档</Link>
                </Text>
              </BlockStack>
            </Banner>
          );
        })()}

        <Banner tone="info" title="重要说明：事件发送与平台归因">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              <strong>本应用仅保证事件生成与发送成功，不保证平台侧归因一致。</strong>
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>我们保证：</strong>事件已成功生成并发送到目标平台 API（GA4 Measurement Protocol、Meta Conversions API、TikTok Events API 等）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>我们不保证：</strong>平台侧报表中的归因数据与 Shopify 订单数据完全一致。平台侧归因受多种因素影响，包括平台算法、用户隐私设置、跨设备追踪限制等。
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>监控报告说明：</strong>本监控面板仅显示事件是否成功发送到平台 API，以及发送成功率。平台侧报表中的归因数据可能因平台算法、数据处理延迟等因素与 Shopify 订单数据存在差异，这是正常现象。
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>

        {!hasData && (
          <EnhancedEmptyState
            icon="📊"
            title="还没开始监控"
            description="连接平台后，我们会基于服务端转化发送日志计算发送成功率，帮助您发现追踪问题。"
            helpText="完成平台连接并产生订单数据后开始评分。"
            primaryAction={{
              content: "配置追踪平台",
              url: "/app/migrate",
            }}
            secondaryAction={{
              content: "配置告警通知",
              url: "/app/settings",
            }}
          />
        )}
        <Banner tone="info" title="关于同意与隐私导致的差异">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              告警说明里必须考虑"同意/隐私"导致的差异：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>Pixel Helper 测试：</strong>可能出现 <strong>"Pixel is awaiting consent"</strong>（不是发送失败，而是等待用户同意）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>隐私设置差异：</strong>不同地区的隐私政策和用户同意设置可能导致事件发送率差异，这是正常现象，不是故障
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              提示：如果 Pixel Helper 显示 "Pixel is awaiting consent"，这表示像素正在等待用户同意，不是追踪失败。请区分因同意阻止导致的差异和真正的发送故障。
            </Text>
          </BlockStack>
        </Banner>

        <Banner tone="info" title="像素加载与事件发送的同意策略说明">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              <strong>为什么只同意 analytics 时 GA4 能发送，但 Meta/TikTok 不能？</strong>
            </Text>
            <Text as="p" variant="bodySm">
              Tracking Guardian Pixel 的加载策略与后端过滤策略保持一致：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>像素加载条件：</strong>当用户同意 <strong>analytics</strong> 时，像素就会加载并发送所有事件到后端
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>后端过滤策略：</strong>
                </Text>
                <ul style={{ marginTop: "8px", marginLeft: "20px" }}>
                  <li><strong>GA4 (Google Analytics)：</strong>只需 analytics 同意即可发送（GA4 是分析工具，不需要 marketing 同意）</li>
                  <li><strong>Meta/TikTok：</strong>需要 marketing + saleOfData 同意才发送（这些是广告平台，需要营销同意）</li>
                </ul>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm">
              <strong>这确保了：</strong>
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">覆盖率：analytics 同意的用户也能被 GA4 追踪（提高数据完整性）</Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">合规性：marketing 平台（Meta/TikTok）仍受严格检查（符合 GDPR/CCPA 要求）</Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">一致性：像素加载条件 ≤ 后端发送条件（像素加载时，至少 GA4 可以发送）</Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              💡 如果用户只同意 analytics 但不同意 marketing，Meta/TikTok 事件会在后端被过滤，但不会影响 GA4 事件的发送。这符合各平台的合规要求。
            </Text>
          </BlockStack>
        </Banner>

        {monitoringAlert && monitoringAlert.shouldAlert && (
          <Banner
            title="监控告警"
            tone={monitoringAlert.severity === "critical" ? "critical" : "warning"}
          >
            <BlockStack gap="200">
              <Text as="p">{monitoringAlert.reason}</Text>
              {monitoringStats && (
                <Text as="p" variant="bodySm" tone="subdued">
                  成功率: {monitoringStats.successRate.toFixed(2)}% |
                  失败率: {monitoringStats.failureRate.toFixed(2)}%
                  {monitoringAlert.stats?.missingParamsRate !== undefined && (
                    <> | 缺参率: {monitoringAlert.stats.missingParamsRate.toFixed(2)}%</>
                  )}
                </Text>
              )}
              <Button size="slim" url="/app/alerts">
                查看告警中心
              </Button>
              {(() => {
                if (monitoringAlert.stats && "byEventType" in monitoringAlert.stats && monitoringAlert.stats.byEventType) {
                  return (
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        按事件类型缺参率：
                      </Text>
                      {Object.entries(monitoringAlert.stats.byEventType as Record<string, number>)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .slice(0, 3)
                        .map(([eventType, rate]) => (
                          <Text key={eventType} as="p" variant="bodySm" tone="subdued">
                            {eventType}: {(rate as number).toFixed(2)}%
                          </Text>
                        ))}
                    </BlockStack>
                  );
                }
                return null;
              })()}
            </BlockStack>
          </Banner>
        )}

        {missingParamsStats && missingParamsStats.length > 0 && monitoringStats && monitoringStats.totalEvents > 0 && (() => {
          const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
          const missingRate = (totalMissing / monitoringStats.totalEvents) * 100;
          return missingRate >= 10 ? (
            <Banner
              title="缺参率告警"
              tone="critical"
            >
              <BlockStack gap="200">
                <Text as="p">
                  总体缺参率 {missingRate.toFixed(2)}% 超过阈值 10%，请检查事件配置。
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  <strong>注意：</strong>本统计仅包含业务字段（value/currency/event_id）缺失。PII字段（email/phone/name等）为null应归因到"隐私过滤/同意状态"，不会在此处统计为故障。
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  受影响的事件类型：
                  {Array.from(new Set(missingParamsStats.map(s => s.eventType))).join(", ")}
                </Text>
                <Button
                  size="slim"
                  url="/app/settings?tab=alerts"
                >
                  配置告警通知
                </Button>
              </BlockStack>
            </Banner>
          ) : missingRate >= 5 ? (
            <Banner
              title="缺参率警告"
              tone="warning"
            >
              <BlockStack gap="200">
                <Text as="p">
                  总体缺参率 {missingRate.toFixed(2)}% 超过警告阈值 5%，建议检查事件配置。
                </Text>
              </BlockStack>
            </Banner>
          ) : null;
        })()}

        {volumeStats && volumeStats.isDrop && (
          <Banner
            title="事件量下降"
            tone={volumeStats.confidence && volumeStats.confidence > 80 ? "critical" : "warning"}
          >
            <BlockStack gap="200">
              <Text as="p">
                最近24小时事件量: {volumeStats.current24h} |
                前24小时: {volumeStats.previous24h} |
                变化: {volumeStats.changePercent.toFixed(2)}%
                {volumeStats.confidence && ` (置信度: ${volumeStats.confidence.toFixed(0)}%)`}
              </Text>
              {volumeStats.detectedReason && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {volumeStats.detectedReason}
                </Text>
              )}
              {(volumeStats.weekdayBaseline !== undefined || volumeStats.weekendBaseline !== undefined) && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {volumeStats.isWeekend ? "周末" : "工作日"}基准值: {
                    volumeStats.isWeekend
                      ? volumeStats.weekendBaseline?.toFixed(0) || "N/A"
                      : volumeStats.weekdayBaseline?.toFixed(0) || "N/A"
                  } |
                  7天平均值: {volumeStats.average7Days?.toFixed(0) || "N/A"} |
                  标准差: {volumeStats.stdDev?.toFixed(0) || "N/A"} |
                  异常阈值: {volumeStats.threshold?.toFixed(0) || "N/A"}
                </Text>
              )}
              {(!volumeStats.weekdayBaseline && !volumeStats.weekendBaseline) && volumeStats.average7Days !== undefined && (
                <Text as="p" variant="bodySm" tone="subdued">
                  7天平均值: {volumeStats.average7Days.toFixed(0)} |
                  标准差: {volumeStats.stdDev?.toFixed(0) || "N/A"} |
                  异常阈值: {volumeStats.threshold?.toFixed(0) || "N/A"}
                </Text>
              )}
              <Text as="p" variant="bodySm" tone="subdued">
                如果下降超过50%，可能发生追踪断档，请检查像素配置和网络连接。
              </Text>
            </BlockStack>
          </Banner>
        )}

        {diagnosticsReport && (
          <Suspense fallback={<CardSkeleton lines={3} />}>
            <DiagnosticsPanel
              report={{
                ...diagnosticsReport,
                timestamp: new Date(diagnosticsReport.timestamp),
              }}
              onRunDiagnostics={() => {
                window.location.reload();
              }}
            />
          </Suspense>
        )}

        {shop && (
          <Suspense fallback={<CardSkeleton lines={3} />}>
            <RealtimeEventMonitor
              shopId={shop.id}
              autoStart={false}
            />
          </Suspense>
        )}

        {successRateHistory && successRateHistory.overall && Array.isArray(successRateHistory.overall) && successRateHistory.overall.length > 0 && (
          <Suspense fallback={<CardSkeleton lines={3} />}>
            <SuccessRateChart
              overall={successRateHistory.overall.filter((item): item is NonNullable<typeof item> => item !== null)}
              byDestination={successRateHistory.byDestination || {}}
              byEventType={successRateHistory.byEventType || {}}
              selectedDestination={selectedSuccessRateDestination === "all" ? undefined : selectedSuccessRateDestination}
              onDestinationChange={setSelectedSuccessRateDestination}
              selectedEventType={selectedSuccessRateEventType === "all" ? undefined : selectedSuccessRateEventType}
              onEventTypeChange={setSelectedSuccessRateEventType}
            />
          </Suspense>
        )}

        {eventVolumeHistory && Array.isArray(eventVolumeHistory) && eventVolumeHistory.length > 0 && volumeStats && (
          <Suspense fallback={<CardSkeleton lines={3} />}>
            <EventVolumeChart
              historyData={eventVolumeHistory.filter((item): item is NonNullable<typeof item> => item !== null)}
              current24h={volumeStats.current24h}
              previous24h={volumeStats.previous24h}
              changePercent={volumeStats.changePercent}
              isDrop={volumeStats.isDrop}
            />
          </Suspense>
        )}

        {monitoringStats && missingParamsStats && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  📊 缺参率监控（最近24小时）
                </Text>
                {monitoringStats.totalEvents > 0 && (
                  <Badge
                    tone={
                      (() => {
                        const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                        const missingRate = (totalMissing / monitoringStats.totalEvents) * 100;
                        return missingRate < 5 ? "success" : missingRate < 10 ? "warning" : "critical";
                      })()
                    }
                  >
                    {(() => {
                      const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                      const missingRate = (totalMissing / monitoringStats.totalEvents) * 100;
                      return `缺参率: ${missingRate.toFixed(2)}%`;
                    })()}
                  </Badge>
                )}
              </InlineStack>

              {monitoringStats.totalEvents === 0 ? (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    暂无事件数据，完成订单后将显示缺参率统计。
                  </Text>
                </Banner>
              ) : missingParamsStats.length === 0 ? (
                <Banner tone="success">
                  <Text as="p" variant="bodySm">
                    ✅ 所有事件参数完整，未发现缺失情况。
                  </Text>
                </Banner>
              ) : (
                <BlockStack gap="300">
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">总体缺参率</Text>
                        <Text
                          as="span"
                          variant="headingLg"
                          tone={(() => {
                            const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                            const missingRate = (totalMissing / monitoringStats.totalEvents) * 100;
                            return missingRate < 5 ? "success" : missingRate < 10 ? undefined : "critical";
                          })()}
                        >
                          {(() => {
                            const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                            const missingRate = (totalMissing / monitoringStats.totalEvents) * 100;
                            return `${missingRate.toFixed(2)}%`;
                          })()}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">缺失事件数</Text>
                        <Text as="span" variant="headingMd">
                          {missingParamsStats.reduce((sum, s) => sum + s.count, 0)} / {monitoringStats.totalEvents}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </Box>

                  <Divider />

                  {monitoringStats.totalEvents > 0 && (
                    <Box
                      background={(() => {
                        const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                        const overallRate = (totalMissing / monitoringStats.totalEvents) * 100;
                        if (overallRate < 5) return "bg-fill-success-secondary";
                        if (overallRate < 10) return "bg-fill-warning-secondary";
                        return "bg-fill-critical-secondary";
                      })()}
                      padding="400"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          总体缺参率
                        </Text>
                        <InlineStack gap="400" wrap>
                          <Box>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">缺参率</Text>
                              <Text
                                as="span"
                                variant="headingXl"
                                tone={(() => {
                                  const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                                  const overallRate = (totalMissing / monitoringStats.totalEvents) * 100;
                                  if (overallRate < 5) return "success";
                                  if (overallRate < 10) return undefined;
                                  return "critical";
                                })()}
                                fontWeight="bold"
                              >
                                {(() => {
                                  const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
                                  return monitoringStats.totalEvents > 0
                                    ? ((totalMissing / monitoringStats.totalEvents) * 100).toFixed(2)
                                    : "0.00";
                                })()}%
                              </Text>
                            </BlockStack>
                          </Box>
                          <Box>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">缺失事件数</Text>
                              <Text as="span" variant="headingLg" fontWeight="semibold">
                                {missingParamsStats.reduce((sum, s) => sum + s.count, 0)} / {monitoringStats.totalEvents}
                              </Text>
                            </BlockStack>
                          </Box>
                          <Box>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">涉及平台/事件</Text>
                              <Text as="span" variant="headingLg" fontWeight="semibold">
                                {missingParamsStats.length} 种组合
                              </Text>
                            </BlockStack>
                          </Box>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}

                  <Text as="h3" variant="headingSm">
                    详细统计
                  </Text>
                  <BlockStack gap="200">
                    {missingParamsStats.slice(0, 10).map((stat, idx) => {
                      const platformName = isValidPlatform(stat.platform)
                        ? PLATFORM_NAMES[stat.platform]
                        : stat.platform;
                      const missingRate = monitoringStats.totalEvents > 0
                        ? (stat.count / monitoringStats.totalEvents) * 100
                        : 0;

                      return (
                        <Box
                          key={idx}
                          background="bg-surface-secondary"
                          padding="300"
                          borderRadius="200"
                        >
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <Badge tone={missingRate < 5 ? "success" : missingRate < 10 ? undefined : "critical"}>
                                  {`${platformName} - ${stat.eventType}`}
                                </Badge>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {stat.count} 次缺失
                                </Text>
                              </InlineStack>
                              <Text as="span" variant="bodySm" fontWeight="semibold">
                                {missingRate.toFixed(2)}%
                              </Text>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="subdued">
                              缺失参数: {stat.missingParams.join(", ")}
                            </Text>
                          </BlockStack>
                        </Box>
                      );
                    })}
                  </BlockStack>

                  {missingParamsStats.length > 10 && (
                    <Banner tone="info">
                      <Text as="p" variant="bodySm">
                        还有 {missingParamsStats.length - 10} 种参数缺失情况未显示。建议检查事件配置。
                      </Text>
                    </Banner>
                  )}
                </BlockStack>
              )}

              {missingParamsDetailed && (
                <>
                  <Divider />
                  <Suspense fallback={<CardSkeleton lines={3} />}>
                    <MissingParamsDetails stats={missingParamsDetailed} />
                  </Suspense>
                </>
              )}

              {missingParamsHistory && missingParamsHistory.length > 0 && (
                <>
                  <Divider />
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">
                        缺参率趋势分析
                      </Text>
                      <Select
                        label="时间范围"
                        labelHidden
                        options={[
                          { label: "最近24小时", value: "24" },
                          { label: "最近7天", value: "7" },
                          { label: "最近30天", value: "30" },
                        ]}
                        value={missingParamsTimeRange}
                        onChange={(value) => {
                          setMissingParamsTimeRange(value);

                          window.location.href = `/app/monitor?timeRange=${value}`;
                        }}
                      />
                    </InlineStack>
                    <Banner tone="info">
                      <Text as="p" variant="bodySm">
                        查看缺参率趋势，识别参数缺失的模式和异常情况。建议关注缺参率超过 10% 的时间段。
                      </Text>
                    </Banner>
                    <Suspense fallback={<CardSkeleton lines={3} />}>
                      <MissingParamsChart
                        historyData={Array.isArray(missingParamsHistory) ? missingParamsHistory.filter((item): item is NonNullable<typeof item> => item !== null) : []}
                        selectedPlatform={selectedChartPlatform}
                        onPlatformChange={setSelectedChartPlatform}
                      />
                    </Suspense>
                  </BlockStack>
                </>
              )}

              {missingParamsDetailed && missingParamsDetailed.byEventType && Object.keys(missingParamsDetailed.byEventType).length > 0 && (
                <>
                  <Divider />
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      按事件类型缺参率分析
                    </Text>
                    <Banner tone="info">
                      <Text as="p" variant="bodySm">
                        不同事件类型的缺参率可能存在差异。重点关注 purchase 事件的缺参情况，因为它直接影响转化追踪。
                      </Text>
                    </Banner>
                    <Card>
                      <BlockStack gap="300">
                        {Object.entries(missingParamsDetailed.byEventType)
                          .sort(([, a], [, b]) => b.rate - a.rate)
                          .slice(0, 5)
                          .map(([eventType, stats]) => (
                            <Box
                              key={eventType}
                              background="bg-surface-secondary"
                              padding="300"
                              borderRadius="200"
                            >
                              <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="center">
                                  <Text as="span" fontWeight="semibold">
                                    {eventType}
                                  </Text>
                                  <Badge
                                    tone={
                                      stats.rate < 5
                                        ? "success"
                                        : stats.rate < 10
                                          ? undefined
                                          : "critical"
                                    }
                                  >
                                    {`缺参率: ${stats.rate.toFixed(2)}%`}
                                  </Badge>
                                </InlineStack>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {stats.missing} / {stats.total} 事件缺失参数
                                </Text>
                                {Object.keys(stats.missingParams).length > 0 && (
                                  <BlockStack gap="100">
                                    <Text as="span" variant="bodySm" fontWeight="semibold">
                                      缺失参数分布：
                                    </Text>
                                    <InlineStack gap="100" wrap>
                                      {Object.entries(stats.missingParams)
                                        .sort(([, a], [, b]) => b - a)
                                        .map(([param, count]) => (
                                          <Badge key={param}>
                                            {`${param}: ${count} 次`}
                                          </Badge>
                                        ))}
                                    </InlineStack>
                                  </BlockStack>
                                )}
                              </BlockStack>
                            </Box>
                          ))}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </Card>
        )}

        {monitoringStats && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                📈 实时监控统计（最近24小时）
              </Text>
              <BlockStack gap="300">
                <InlineStack gap="400" wrap>
                  <Box minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">总事件数</Text>
                      <Text as="span" variant="headingLg">{monitoringStats.totalEvents}</Text>
                    </BlockStack>
                  </Box>
                  <Box minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">成功率</Text>
                      <Text as="span" variant="headingLg" tone={monitoringStats.successRate >= 95 ? "success" : monitoringStats.successRate >= 90 ? undefined : "critical"}>
                        {monitoringStats.successRate.toFixed(2)}%
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box minWidth="200px">
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued">失败率</Text>
                      <Text as="span" variant="headingLg" tone={monitoringStats.failureRate < 2 ? "success" : monitoringStats.failureRate < 5 ? undefined : "critical"}>
                        {monitoringStats.failureRate.toFixed(2)}%
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineStack>
                {Object.keys(monitoringStats.byPlatform).length > 0 && (
                  <>
                    <Divider />
                    <Text as="h3" variant="headingSm">
                      按平台统计
                    </Text>
                    {Object.entries(monitoringStats.byPlatform).map(([platform, stats]) => (
                      <Box key={platform} background="bg-surface-secondary" padding="300" borderRadius="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {isValidPlatform(platform) ? PLATFORM_NAMES[platform] : platform}
                          </Text>
                          <InlineStack gap="300">
                            <Badge tone={stats.successRate >= 95 ? "success" : stats.successRate >= 90 ? undefined : "critical"}>
                              {`成功率: ${stats.successRate.toFixed(2)}%`}
                            </Badge>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {stats.success}/{stats.total}
                            </Text>
                          </InlineStack>
                        </InlineStack>
                      </Box>
                    ))}
                  </>
                )}
                {Object.keys(monitoringStats.byEventType).length > 0 && (
                  <>
                    <Divider />
                    <Text as="h3" variant="headingSm">
                      按事件类型统计
                    </Text>
                    {Object.entries(monitoringStats.byEventType)
                      .sort(([, a], [, b]) => b.total - a.total)
                      .map(([eventType, stats]) => (
                        <Box key={eventType} background="bg-surface-secondary" padding="300" borderRadius="200">
                          <BlockStack gap="200">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="span" fontWeight="semibold">
                                {eventType}
                              </Text>
                              <InlineStack gap="300">
                                <Badge tone={stats.successRate >= 95 ? "success" : stats.successRate >= 90 ? undefined : "critical"}>
                                  {`成功率: ${stats.successRate.toFixed(2)}%`}
                                </Badge>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {stats.success}/{stats.total}
                                </Text>
                              </InlineStack>
                            </InlineStack>
                            <ProgressBar
                              progress={stats.successRate}
                              tone={stats.successRate >= 95 ? "success" : stats.successRate >= 90 ? undefined : "critical"}
                              size="small"
                            />
                            <InlineStack align="space-between">
                              <Text as="span" variant="bodySm" tone="subdued">
                                失败: {stats.failed} ({stats.failureRate.toFixed(2)}%)
                              </Text>
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      ))}
                  </>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {channelReconciliation && channelReconciliation.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                🔄 渠道对账（最近24小时）
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                比较 Shopify 订单与平台事件的一致性，确保追踪数据准确
              </Text>
              <BlockStack gap="300">
                {Array.isArray(channelReconciliation) && channelReconciliation.map((recon) => {
                  if (!recon) return null;
                  const platformName = isValidPlatform(recon.platform)
                    ? PLATFORM_NAMES[recon.platform]
                    : recon.platform;

                  return (
                    <Box
                      key={recon.platform}
                      background={
                        recon.matchRate >= 95
                          ? "bg-surface-success"
                          : recon.matchRate >= 90
                            ? "bg-surface-warning"
                            : "bg-surface-critical"
                      }
                      padding="400"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {platformName}
                          </Text>
                          <Badge
                            tone={
                              recon.matchRate >= 95
                                ? "success"
                                : recon.matchRate >= 90
                                  ? undefined
                                  : "critical"
                            }
                          >
                            {`匹配率: ${recon.matchRate.toFixed(2)}%`}
                          </Badge>
                        </InlineStack>
                        <BlockStack gap="100">
                          <InlineStack align="space-between">
                            <Text as="span" variant="bodySm" tone="subdued">
                              Shopify 订单
                            </Text>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {recon.shopifyOrders}
                            </Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text as="span" variant="bodySm" tone="subdued">
                              平台事件
                            </Text>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {recon.platformEvents}
                            </Text>
                          </InlineStack>
                          {recon.discrepancy > 0 && (
                            <InlineStack align="space-between">
                              <Text as="span" variant="bodySm" tone="subdued">
                                差异
                              </Text>
                              <Text
                                as="span"
                                variant="bodySm"
                                fontWeight="semibold"
                                tone={recon.discrepancyRate > 10 ? "critical" : undefined}
                              >
                                {recon.discrepancy} ({recon.discrepancyRate.toFixed(2)}%)
                              </Text>
                            </InlineStack>
                          )}
                        </BlockStack>
                      </BlockStack>
                    </Box>
                  );
                })}
              </BlockStack>
              {Array.isArray(channelReconciliation) && channelReconciliation.some((r) => r && r.discrepancyRate > 10) && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    ⚠️ 部分平台存在较大差异，建议检查事件发送配置或联系平台技术支持。
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        )}

        {dedupAnalysis && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  🔄 去重冲突检测（最近24小时）
                </Text>
                {dedupAnalysis.duplicateRate > 5 ? (
                  <Badge tone="critical">{`冲突率: ${dedupAnalysis.duplicateRate.toFixed(2)}%`}</Badge>
                ) : dedupAnalysis.duplicateRate > 1 ? (
                  <Badge>{`冲突率: ${dedupAnalysis.duplicateRate.toFixed(2)}%`}</Badge>
                ) : (
                  <Badge tone="success">{`冲突率: ${dedupAnalysis.duplicateRate.toFixed(2)}%`}</Badge>
                )}
              </InlineStack>

              {dedupAnalysis.totalEvents === 0 ? (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    暂无事件数据，完成订单后将显示去重冲突统计。
                  </Text>
                </Banner>
              ) : dedupAnalysis.duplicateEvents === 0 ? (
                <Banner tone="success">
                  <Text as="p" variant="bodySm">
                    ✅ 未检测到去重冲突，所有事件 ID 唯一。
                  </Text>
                </Banner>
              ) : (
                <BlockStack gap="300">
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">冲突率</Text>
                        <Text
                          as="span"
                          variant="headingLg"
                          tone={dedupAnalysis.duplicateRate > 5 ? "critical" : dedupAnalysis.duplicateRate > 1 ? undefined : "success"}
                        >
                          {dedupAnalysis.duplicateRate.toFixed(2)}%
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">冲突事件数</Text>
                        <Text as="span" variant="headingMd">
                          {dedupAnalysis.duplicateEvents} / {dedupAnalysis.totalEvents}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">唯一事件数</Text>
                        <Text as="span" variant="headingMd" tone="success">
                          {dedupAnalysis.uniqueEvents}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </Box>

                  <Divider />

                  {Object.keys(dedupAnalysis.byPlatform).length > 0 && (
                    <>
                      <Text as="h3" variant="headingSm">
                        按平台统计
                      </Text>
                      <BlockStack gap="200">
                        {Object.entries(dedupAnalysis.byPlatform).map(([platform, stats]) => {
                          const platformName = isValidPlatform(platform)
                            ? PLATFORM_NAMES[platform]
                            : platform;
                          return (
                            <Box
                              key={platform}
                              background="bg-surface-secondary"
                              padding="300"
                              borderRadius="200"
                            >
                              <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="center">
                                  <Text as="span" fontWeight="semibold">
                                    {platformName}
                                  </Text>
                                  <Badge
                                    tone={
                                      stats.duplicateRate > 5
                                        ? "critical"
                                        : stats.duplicateRate > 1
                                          ? undefined
                                          : "success"
                                    }
                                  >
                                    {`冲突率: ${stats.duplicateRate.toFixed(2)}%`}
                                  </Badge>
                                </InlineStack>
                                <InlineStack align="space-between">
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    总事件数
                                  </Text>
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    {stats.total}
                                  </Text>
                                </InlineStack>
                                <InlineStack align="space-between">
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    冲突事件数
                                  </Text>
                                  <Text
                                    as="span"
                                    variant="bodySm"
                                    fontWeight="semibold"
                                    tone={stats.duplicates > 0 ? undefined : "success"}
                                  >
                                    {stats.duplicates}
                                  </Text>
                                </InlineStack>
                              </BlockStack>
                            </Box>
                          );
                        })}
                      </BlockStack>
                    </>
                  )}

                  {dedupAnalysis.topDuplicates.length > 0 && (
                    <>
                      <Divider />
                      <Text as="h3" variant="headingSm">
                        主要冲突事件（前10个）
                      </Text>
                      <DataTable
                        columnContentTypes={["text", "text", "text", "numeric"]}
                        headings={["订单ID", "平台", "事件ID", "重复次数"]}
                        rows={dedupAnalysis.topDuplicates.slice(0, 10).map((dup) => [
                          dup.orderId,
                          isValidPlatform(dup.platform) ? PLATFORM_NAMES[dup.platform] : dup.platform,
                          dup.eventId || "-",
                          dup.count.toString(),
                        ])}
                      />
                    </>
                  )}

                  {dedupAnalysis.duplicateRate > 5 && (
                    <Banner tone="critical">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          ⚠️ 去重冲突率较高
                        </Text>
                        <Text as="p" variant="bodySm">
                          检测到 {dedupAnalysis.duplicateEvents} 个重复事件，冲突率为 {dedupAnalysis.duplicateRate.toFixed(2)}%。
                          这可能导致平台侧重复计算转化数据。建议检查事件发送逻辑，确保每个订单的每个事件类型只发送一次。
                        </Text>
                      </BlockStack>
                    </Banner>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}

        {(currentAlertStatus.length > 0 || !alertConfigs) && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  🔔 告警状态
                </Text>
                <Badge tone={currentAlertStatus.length > 0 ? "critical" : "success"}>
                  {currentAlertStatus.length > 0 ? `${currentAlertStatus.length} 个告警` : "正常"}
                </Badge>
              </InlineStack>

              {currentAlertStatus.length > 0 ? (
                <BlockStack gap="300">
                  {currentAlertStatus.map((alert, idx) => (
                    <Box
                      key={idx}
                      background={
                        alert.severity === "critical"
                          ? "bg-fill-critical-secondary"
                          : alert.severity === "high"
                            ? "bg-fill-warning-secondary"
                            : "bg-surface-secondary"
                      }
                      padding="400"
                      borderRadius="200"
                    >
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="200">
                          <InlineStack gap="200" blockAlign="center">
                            <Icon
                              source={AlertCircleIcon}
                              tone={alert.severity === "critical" ? "critical" : "warning"}
                            />
                            <Text as="span" fontWeight="semibold">
                              {alert.alertType === "failure_rate"
                                ? "事件失败率过高"
                                : alert.alertType === "missing_params"
                                  ? "参数缺失率过高"
                                  : alert.alertType === "volume_drop"
                                    ? "事件量骤降"
                                    : alert.alertType === "dedup_conflict"
                                      ? "去重冲突"
                                      : alert.alertType === "pixel_heartbeat"
                                        ? "像素心跳丢失"
                                        : "告警"}
                            </Text>
                            <Badge
                              tone={
                                alert.severity === "critical"
                                  ? "critical"
                                  : alert.severity === "high"
                                    ? "warning"
                                    : "info"
                              }
                            >
                              {alert.severity === "critical"
                                ? "严重"
                                : alert.severity === "high"
                                  ? "高"
                                  : "中"}
                            </Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm">
                            {alert.message}
                          </Text>
                        </BlockStack>
                        <Button url="/app/settings?tab=alerts" size="slim" variant="secondary">
                          配置告警
                        </Button>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              ) : (
                <Banner tone="success">
                  <Text as="p" variant="bodySm">
                    ✅ 所有监控指标正常，未发现异常情况。
                  </Text>
                </Banner>
              )}

              {!alertConfigs && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      ⚠️ 尚未配置告警通知。配置后，当追踪出现异常时会自动通知您。
                    </Text>
                    <Button url="/app/settings?tab=alerts" size="slim" variant="primary">
                      立即配置告警
                    </Button>
                  </BlockStack>
                </Banner>
              )}

              {alertConfigs && alertCount > 0 && (
                <InlineStack gap="200" align="end">
                  <Text as="p" variant="bodySm" tone="subdued">
                    已配置 {alertCount} 个告警渠道
                  </Text>
                  <Button url="/app/settings?tab=alerts" size="slim" variant="plain">
                    管理告警
                  </Button>
                </InlineStack>
              )}

              {recentAlerts.length > 0 && (
                <>
                  <Divider />
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">
                        告警历史
                      </Text>
                      <Button url="/app/settings?tab=alerts" variant="plain" size="slim">
                        查看全部
                      </Button>
                    </InlineStack>

                    <Suspense fallback={<CardSkeleton lines={3} />}>
                      <AlertHistoryChart
                        alerts={recentAlerts}
                        timeRange={alertHistoryTimeRange}
                        onTimeRangeChange={setAlertHistoryTimeRange}
                      />
                    </Suspense>

                    <Divider />

                    <BlockStack gap="300">
                      <Text as="h4" variant="headingSm">
                        最近告警记录
                      </Text>
                      <DataTable
                        columnContentTypes={["text", "text", "text", "text", "text"]}
                        headings={["时间", "类型", "严重程度", "消息", "状态"]}
                        rows={recentAlerts.slice(0, 10).map((alert) => [
                          new Date(alert.createdAt).toLocaleString("zh-CN"),
                          alert.alertType === "failure_rate"
                            ? "失败率"
                            : alert.alertType === "missing_params"
                              ? "缺参率"
                              : alert.alertType === "volume_drop"
                                ? "量降"
                                : alert.alertType === "dedup_conflict"
                                  ? "去重冲突"
                                  : alert.alertType === "pixel_heartbeat"
                                    ? "心跳丢失"
                                    : alert.alertType,
                          <Badge
                            key={`severity-${alert.id}`}
                            tone={
                              alert.severity === "critical"
                                ? "critical"
                                : alert.severity === "high"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {alert.severity === "critical"
                              ? "严重"
                              : alert.severity === "high"
                                ? "高"
                                : "中"}
                          </Badge>,
                          alert.message,
                          alert.acknowledged ? (
                            <Badge key={`ack-${alert.id}`} tone="success">已确认</Badge>
                          ) : (
                            <Badge key={`ack-${alert.id}`} tone="attention">未确认</Badge>
                          ),
                        ])}
                      />
                    </BlockStack>
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </Card>
        )}

        {hasData && (<Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      整体健康度
                    </Text>
                    <Badge tone={healthScore !== null && healthScore > 80
                ? "success"
                : healthScore !== null && healthScore > 60
                    ? "attention"
                    : "critical"}>
                      {healthScore !== null && healthScore > 80
                ? "健康"
                : healthScore !== null && healthScore > 60
                    ? "有风险"
                    : "需要关注"}
                    </Badge>
                  </InlineStack>
                  <Box background={healthScore !== null && healthScore > 80
                ? "bg-fill-success"
                : healthScore !== null && healthScore > 60
                    ? "bg-fill-warning"
                    : "bg-fill-critical"} padding="600" borderRadius="200">
                    <BlockStack gap="200" align="center">
                      <Text as="p" variant="heading3xl" fontWeight="bold">
                        {healthScore ?? "--"}
                      </Text>
                      <Text as="p" variant="bodySm">
                        / 100
                      </Text>
                    </BlockStack>
                  </Box>
                  <ProgressBar progress={healthScore ?? 0} tone={healthScore !== null && healthScore > 80
                ? "success"
                : healthScore !== null && healthScore > 60
                    ? "highlight"
                    : "critical"}/>
                  <Text as="p" variant="bodySm" tone="subdued">
                    评分依据：过去 7 天发送成功率
                  </Text>
                  </BlockStack>
                </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      告警状态
                    </Text>
                    <Badge tone={alertSummaryTone}>
                      {currentAlertStatus.length > 0 ? `${currentAlertStatus.length} 个告警` : "正常"}
                    </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    基于最新告警检测结果。
                  </Text>
                  {currentAlertStatus.length > 0 ? (
                    <BlockStack gap="200">
                      <InlineStack gap="200" wrap>
                        {Object.entries(alertSeveritySummary).map(([severity, count]) => (
                          <Badge
                            key={severity}
                            tone={severity === "critical" ? "critical" : severity === "high" ? "warning" : "info"}
                          >
                            {severity === "critical"
                              ? `严重 ${count}`
                              : severity === "high"
                                ? `高 ${count}`
                                : `中 ${count}`}
                          </Badge>
                        ))}
                      </InlineStack>
                      <BlockStack gap="100">
                        {currentAlertStatus.slice(0, 2).map((alert, idx) => (
                          <Text key={`${alert.alertType}-${idx}`} as="p" variant="bodySm">
                            {alert.alertType === "failure_rate"
                              ? "事件失败率过高"
                              : alert.alertType === "missing_params"
                                ? "参数缺失率过高"
                                : alert.alertType === "volume_drop"
                                  ? "事件量骤降"
                                  : alert.alertType === "dedup_conflict"
                                    ? "去重冲突"
                                    : alert.alertType === "pixel_heartbeat"
                                      ? "像素心跳丢失"
                                      : "告警"}
                            ：{alert.message}
                          </Text>
                        ))}
                      </BlockStack>
                    </BlockStack>
                  ) : (
                    <Text as="p" variant="bodySm">
                      ✅ 未发现异常告警。
                    </Text>
                  )}
                  <Button url="/app/alerts" size="slim" variant="plain">
                    进入告警中心
                  </Button>
                </BlockStack>
              </Card>
            </Layout.Section>

            {Object.entries(summaryData).map(([platform, data]) => (<Layout.Section key={platform} variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">
                        {isValidPlatform(platform) ? PLATFORM_NAMES[platform] : platform}
                      </Text>
                      <Badge tone={data.avgSuccessRate >= 0.95
                    ? "success"
                    : data.avgSuccessRate >= 0.8
                        ? "attention"
                        : "critical"}>
                        {`${(data.avgSuccessRate * 100).toFixed(1)}% 成功率`}
                      </Badge>
                    </InlineStack>
                    <Divider />
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">
                        尝试发送
                      </Text>
                      <Text as="span" fontWeight="semibold">
                        {data.last7DaysAttempted}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">
                        成功发送
                      </Text>
                      <Text as="span" fontWeight="semibold">
                        {data.last7DaysSent}
                      </Text>
                    </InlineStack>
                    {data.topFailureReasons.length > 0 && (<>
                        <Divider />
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" tone="subdued">
                            主要失败原因：{data.topFailureReasons[0]?.reason || "未知"}
                          </Text>
                          {}
                          {(() => {
                            const reason = data.topFailureReasons[0]?.reason || "";
                            const isPrivacyFilter =
                              reason.includes("consent") ||
                              reason.includes("同意") ||
                              reason.includes("privacy") ||
                              reason.includes("隐私") ||
                              reason.includes("PII") ||
                              reason.includes("protected customer data");

                            if (isPrivacyFilter) {
                              return (
                                <Banner tone="info" size="small">
                                  <Text as="p" variant="bodySm">
                                    <strong>隐私过滤/同意状态：</strong>这是由 PII 字段为 null 导致的，不是真实故障。请检查应用的 protected customer data 权限配置和客户的隐私同意状态。
                                  </Text>
                                </Banner>
                              );
                            }

                            return (
                              <Banner tone="warning" size="small">
                                <Text as="p" variant="bodySm">
                                  <strong>真实故障：</strong>这可能是配置错误或网络问题导致的。请检查像素配置和网络连接。
                                </Text>
                              </Banner>
                            );
                          })()}
                        </BlockStack>
                      </>)}
                  </BlockStack>
                </Card>
              </Layout.Section>))}
          </Layout>)}

        {processedStats && Object.keys(processedStats).length > 0 && (<Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                过去 7 天转化发送统计
              </Text>
              <DataTable columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]} headings={["平台", "总转化", "成功发送", "发送失败", "发送成功率"]} rows={Object.entries(processedStats).map(([platform, stats]) => [
                isValidPlatform(platform) ? PLATFORM_NAMES[platform] : platform,
                stats.total,
                stats.sent,
                stats.failed,
                stats.total > 0
                    ? `${((stats.sent / stats.total) * 100).toFixed(1)}%`
                    : "-",
            ])}/>
            </BlockStack>
          </Card>)}

        {historyData.length > 0 && (<Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  发送日志核对记录
                </Text>
                <Select label="" labelHidden options={platformOptions} value={selectedPlatform} onChange={setSelectedPlatform}/>
              </InlineStack>
              <DataTable columnContentTypes={[
                "text",
                "text",
                "numeric",
                "numeric",
                "text",
                "text",
            ]} headings={[
                "日期",
                "平台",
                "待发送",
                "成功发送",
                "失败率",
                "状态",
            ]} rows={filteredHistory.slice(0, 50).map((report) => [
                new Date(report.reportDate).toLocaleDateString("zh-CN"),
                isValidPlatform(report.platform) ? PLATFORM_NAMES[report.platform] : report.platform,
                report.shopifyOrders,
                report.platformConversions,
                `${(report.orderDiscrepancy * 100).toFixed(1)}%`,
                report.alertSent ? "⚠️ 已报警" : "✓ 正常",
            ])}/>
            </BlockStack>
          </Card>)}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                运行环境自检
              </Text>
              <Badge tone={!isHeartbeatStale ? "success" : "warning"}>
                {!isHeartbeatStale ? "连接正常" : "无近期心跳"}
              </Badge>
            </InlineStack>

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                   <Text as="span" tone="subdued">当前应用后端 (App URL)</Text>
                   <Text as="span" fontWeight="semibold">{configHealth.appUrl || "未检测到"}</Text>
                </InlineStack>
                {isDevUrl && (
                  <Banner tone="warning">
                    <Text as="p" variant="bodySm">
                      ⚠️ 检测到开发环境 URL (ngrok/cloudflare)。请确保 Web Pixel 扩展已使用最新 URL 重新构建/推送，否则可能导致事件发送失败。
                    </Text>
                  </Banner>
                )}
                {environmentWarning && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">
                      {environmentWarning}
                    </Text>
                  </Banner>
                )}

                <Divider />

                <InlineStack align="space-between" blockAlign="center">
                   <InlineStack gap="200" blockAlign="center">
                     <Badge tone={heartbeatTone}>{heartbeatLabel}</Badge>
                     <Text as="span" tone="subdued">最近一次 Pixel 心跳</Text>
                   </InlineStack>
                   <Text as="span" fontWeight={configHealth.lastPixelTime ? "semibold" : "regular"}>
                     {configHealth.lastPixelTime
                       ? (() => {
                           try {
                             const date = new Date(configHealth.lastPixelTime);
                             return isNaN(date.getTime()) ? "尚未收到事件" : date.toLocaleString("zh-CN");
                           } catch {
                             return "尚未收到事件";
                           }
                         })()
                       : "尚未收到事件"}
                   </Text>
                </InlineStack>

                {configHealth.lastPixelOrigin && (
                  <InlineStack align="space-between">
                     <Text as="span" tone="subdued">来源店铺域名 (Origin)</Text>
                     <Text as="span">{configHealth.lastPixelOrigin}</Text>
                  </InlineStack>
                )}

                <Text as="p" variant="bodySm" tone="subdued">
                  {heartbeatDescription}
                </Text>

                {(isHeartbeatStale || !lastHeartbeat) && (
                  <InlineStack gap="200" wrap>
                    <Button url="/app/migrate#pixel" icon={RefreshIcon} variant="primary">
                      重新推送 App Pixel
                    </Button>
                    <Button url="/app/reconciliation" icon={SearchIcon}>
                      打开送达对账
                    </Button>
                    <Button url="/app/audit/start" icon={SearchIcon} variant="secondary">
                      重新扫描追踪配置
                    </Button>
                  </InlineStack>
                )}

                {isHeartbeatStale && hasData && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">
                      超过 24 小时未收到 Web Pixel 心跳事件。请检查：<br />
                      1) Web Pixel 是否在 Shopify 后台被禁用<br />
                      2) 域名是否更换（ngrok 重启后需更新 Pixel 配置）<br />
                      3) 如为生产店铺，确认 storefront 是否启用新的 Thank you / Order status 页面
                    </Text>
                  </Banner>
                )}
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                测试模式与事件对账
              </Text>
              <Badge tone={heartbeatTone}>
                {heartbeatTone === "success" ? "已收到心跳" : "需要测试订单"}
              </Badge>
            </InlineStack>
            <Text as="p" tone="subdued">
              使用下方步骤跑一单“测试订单”，可以验证 CAPI / Web Pixel 是否同时送达并排除参数缺失问题。
            </Text>
            <List type="bullet">
              <List.Item>创建 1 笔低金额测试订单，确保结账完成后看到 Thank you / Order status 页面</List.Item>
              <List.Item>在本页面查看“最近一次 Pixel 心跳”是否更新，并确认来源域名与环境匹配</List.Item>
              <List.Item>前往“送达对账”页核对平台返回的发送结果与参数（如订单金额、货币、客户标识）</List.Item>
              <List.Item>若仍未收到事件，重新在“迁移”页点击“启用/升级 App Pixel”以刷新最新 backend URL</List.Item>
            </List>
            <InlineStack gap="200" wrap>
              <Button url="/app/audit/start" icon={RefreshIcon} variant="primary">
                重新扫描像素配置
              </Button>
              <Button url="/app/reconciliation" icon={SearchIcon}>
                查看送达对账
              </Button>
              <Button url="/app/migrate#pixel" icon={RefreshIcon} variant="secondary">
                重新推送 App Pixel
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              提高追踪准确性的建议
            </Text>
            <BlockStack gap="300">

              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={SettingsIcon} tone="base"/>
                      <Text as="span" fontWeight="semibold">
                        启用服务端追踪
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      配置 Conversions API（CAPI）可降低广告拦截器影响，提高追踪数据的一致性
                    </Text>
                  </BlockStack>
                  <Button url="/app/settings" size="slim" icon={ArrowRightIcon}>
                    配置
                  </Button>
                </InlineStack>
              </Box>

              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={SearchIcon} tone="base"/>
                      <Text as="span" fontWeight="semibold">
                        检查 Web Pixel 配置
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      确保 Web Pixel 代码在所有页面正常加载，验证事件是否正确触发
                    </Text>
                  </BlockStack>
                  <Button url="/app/migrate" size="slim" icon={ArrowRightIcon}>
                    验证
                  </Button>
                </InlineStack>
              </Box>

              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={RefreshIcon} tone="base"/>
                      <Text as="span" fontWeight="semibold">
                        定期扫描追踪脚本
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      建议每月进行一次扫描，确保追踪配置最新，及时发现问题
                    </Text>
                  </BlockStack>
                  <Button url="/app/audit/start" size="slim" icon={ArrowRightIcon}>
                    扫描
                  </Button>
                </InlineStack>
              </Box>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>);
}
