
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
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
  DatePicker,
  Banner,
} from "@shopify/polaris";
import { ExportIcon, DownloadIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkFeatureAccess } from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";

interface LoaderData {
  shop: {
    id: string;
    plan: PlanId;
  } | null;
  shopDomain: string;
  stats: {
    total: number;
    withRating: number;
    withFeedback: number;
    averageRating: number;
    sourceBreakdown: Array<{ source: string; count: number }>;
    ratingBreakdown: Array<{ rating: number; count: number }>;
  };
  recentResponses: Array<{
    id: string;
    orderId: string;
    orderNumber: string | null;
    rating: number | null;
    source: string | null;
    feedback: string | null;
    createdAt: Date;
  }>;
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
      stats: {
        total: 0,
        withRating: 0,
        withFeedback: 0,
        averageRating: 0,
        sourceBreakdown: [],
        ratingBreakdown: [],
      },
      recentResponses: [],
    });
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const canAccess = checkFeatureAccess(planId, "verification");

  const allResponses = await prisma.surveyResponse.findMany({
    where: { shopId: shop.id },
    select: {
      rating: true,
      feedback: true,
      source: true,
    },
  });

  const total = allResponses.length;
  const withRating = allResponses.filter((r) => r.rating !== null).length;
  const withFeedback = allResponses.filter((r) => r.feedback !== null && r.feedback.trim() !== "").length;
  const averageRating =
    withRating > 0
      ? allResponses
          .filter((r) => r.rating !== null)
          .reduce((sum, r) => sum + (r.rating || 0), 0) / withRating
      : 0;

  const sourceMap = new Map<string, number>();
  allResponses.forEach((r) => {
    if (r.source) {
      sourceMap.set(r.source, (sourceMap.get(r.source) || 0) + 1);
    }
  });
  const sourceBreakdown = Array.from(sourceMap.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  const ratingMap = new Map<number, number>();
  allResponses.forEach((r) => {
    if (r.rating !== null) {
      ratingMap.set(r.rating, (ratingMap.get(r.rating) || 0) + 1);
    }
  });
  const ratingBreakdown = Array.from(ratingMap.entries())
    .map(([rating, count]) => ({ rating, count }))
    .sort((a, b) => b.rating - a.rating);

  const recentResponses = await prisma.surveyResponse.findMany({
    where: { shopId: shop.id },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      rating: true,
      source: true,
      feedback: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return json<LoaderData>({
    shop: { id: shop.id, plan: planId },
    shopDomain,
    stats: {
      total,
      withRating,
      withFeedback,
      averageRating: Math.round(averageRating * 10) / 10,
      sourceBreakdown,
      ratingBreakdown,
    },
    recentResponses,
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

  if (actionType === "export_csv") {

    const dateFrom = formData.get("dateFrom") as string | null;
    const dateTo = formData.get("dateTo") as string | null;

    const params = new URLSearchParams();
    params.set("type", "survey");
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    return redirect(`/api/exports?${params.toString()}`);
  }

  return json({ error: "无效的操作" }, { status: 400 });
};

export default function SurveyPage() {
  const { shop, shopDomain, stats, recentResponses } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date } | null>(null);

  const handleExport = () => {
    const formData = new FormData();
    formData.append("_action", "export_csv");
    if (dateRange?.start) {
      formData.append("dateFrom", dateRange.start.toISOString().split("T")[0]);
    }
    if (dateRange?.end) {
      formData.append("dateTo", dateRange.end.toISOString().split("T")[0]);
    }
    submit(formData, { method: "post" });
  };

  if (!shop) {
    return (
      <Page title="问卷数据">
        <Banner tone="critical">店铺未找到</Banner>
      </Page>
    );
  }

  const responseRows = recentResponses.map((response) => {

    let dateStr = "-";
    if (response.createdAt) {
      try {
        const date = new Date(response.createdAt);
        if (!isNaN(date.getTime())) {
          dateStr = date.toLocaleDateString("zh-CN");
        }
      } catch {

        dateStr = "-";
      }
    }
    return [
      response.orderNumber || response.orderId.slice(0, 8),
      response.rating ? `${response.rating} ⭐` : "-",
      response.source || "-",
      response.feedback ? (response.feedback.length > 50 ? `${response.feedback.slice(0, 50)}...` : response.feedback) : "-",
      dateStr,
    ];
  });

  return (
    <Page
      title="售后问卷数据"
      subtitle="查看和分析客户的购后反馈"
      primaryAction={{
        content: "导出 CSV",
        icon: ExportIcon,
        onAction: handleExport,
      }}
    >
      <BlockStack gap="500">
        {}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  总回复数
                </Text>
                <Text as="p" variant="heading2xl">
                  {stats.total}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.withRating} 条包含评分，{stats.withFeedback} 条包含反馈
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  平均评分
                </Text>
                <Text as="p" variant="heading2xl">
                  {stats.averageRating > 0 ? `${stats.averageRating.toFixed(1)} ⭐` : "-"}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  基于 {stats.withRating} 条有效评分
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  来源渠道
                </Text>
                <BlockStack gap="100">
                  {stats.sourceBreakdown.slice(0, 3).map((item) => (
                    <InlineStack key={item.source} align="space-between">
                      <Text as="span" variant="bodySm">
                        {item.source}
                      </Text>
                      <Badge>{String(item.count)}</Badge>
                    </InlineStack>
                  ))}
                  {stats.sourceBreakdown.length === 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      暂无数据
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {}
        {stats.ratingBreakdown.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                评分分布
              </Text>
              <BlockStack gap="200">
                {stats.ratingBreakdown.map((item) => (
                  <BlockStack key={item.rating} gap="100">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        {item.rating} ⭐
                      </Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {item.count} ({Math.round((item.count / stats.withRating) * 100)}%)
                      </Text>
                    </InlineStack>
                    <Box
                      background="bg-surface-secondary"
                      minHeight="8px"
                      borderRadius="100"
                    >
                      <div style={{ width: `${(item.count / stats.withRating) * 100}%`, height: "100%" }} />
                    </Box>
                  </BlockStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                最近回复
              </Text>
              <Button url="/api/exports?type=survey" icon={DownloadIcon} size="slim">
                导出全部
              </Button>
            </InlineStack>
            {responseRows.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["订单号", "评分", "来源", "反馈", "时间"]}
                rows={responseRows}
              />
            ) : (
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  暂无问卷回复
                </Text>
              </Box>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

