import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  Button,
  Banner,
  InlineStack,
  Box,
  DataTable,
  Select,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { performPixelVsOrderReconciliation } from "../services/verification/order-reconciliation.server";
import { PCD_CONFIG } from "../utils/config.server";

const HOUR_OPTIONS = [
  { label: "最近 24 小时", value: "24" },
  { label: "最近 72 小时", value: "72" },
  { label: "最近 7 天", value: "168" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return json({
      shop: null,
      reconciliation: null,
      hours: 24,
      pcdDisabled: false,
    });
  }
  const url = new URL(request.url);
  const hoursParam = url.searchParams.get("hours");
  const hours = Math.min(
    168,
    Math.max(1,
      hoursParam ? parseInt(hoursParam, 10) || 24 : 24
    )
  );
  const pcdDisabled = !PCD_CONFIG.APPROVED;
  const reconciliation = pcdDisabled ? null : await performPixelVsOrderReconciliation(shop.id, hours);
  return json({
    shop: { id: shop.id, domain: shopDomain },
    reconciliation,
    hours,
    pcdDisabled,
  });
};

export default function VerificationOrdersPage() {
  const { shop, reconciliation, hours, pcdDisabled } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleHoursChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("hours", value);
    setSearchParams(next);
  };

  if (!shop) {
    return (
      <Page title="订单层验收">
        <Banner tone="warning">
          <Text as="p">店铺信息未找到，请重新安装应用。</Text>
        </Banner>
        <Button url="/app/verification" variant="primary">
          返回验收页面
        </Button>
      </Page>
    );
  }

  if (pcdDisabled) {
    return (
      <Page title="订单层验收" backAction={{ content: "验收", url: "/app/verification" }}>
        <BlockStack gap="400">
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                当前未启用订单对账
              </Text>
              <Text as="p" variant="bodySm">
                订单层验收依赖 Shopify 订单数据，需获得 PCD（Protected Customer Data）审批后启用。当前版本仅提供像素收据层验收，请在「验收」页使用像素层验收与报告导出。
              </Text>
            </BlockStack>
          </Banner>
          <Button url="/app/verification" variant="primary">
            返回验收页面
          </Button>
        </BlockStack>
      </Page>
    );
  }

  if (!reconciliation) {
    return (
      <Page title="订单层验收">
        <Banner tone="warning">
          <Text as="p">店铺信息未找到，请重新安装应用。</Text>
        </Banner>
        <Button url="/app/verification" variant="primary">
          返回验收页面
        </Button>
      </Page>
    );
  }

  const exportUrl = `/api/verification-orders-report.csv?hours=${hours}`;

  return (
    <Page
      title="订单层验收"
      backAction={{ content: "验收", url: "/app/verification" }}
      primaryAction={{
        content: "导出 CSV",
        url: exportUrl,
      }}
    >
      <BlockStack gap="400">
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {reconciliation.reasonableMissingNote}
            </Text>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center" gap="400">
              <Text as="h2" variant="headingMd">
                对账概览
              </Text>
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  时间窗
                </Text>
                <Select
                  label=""
                  labelHidden
                  options={HOUR_OPTIONS}
                  value={String(hours)}
                  onChange={handleHoursChange}
                />
              </InlineStack>
            </InlineStack>
            <InlineStack gap="600" wrap>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200" minWidth="140px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    总订单数
                  </Text>
                  <Text as="p" variant="headingLg">
                    {reconciliation.totalOrders}
                  </Text>
                </BlockStack>
              </Box>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200" minWidth="140px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    有像素订单数
                  </Text>
                  <Text as="p" variant="headingLg">
                    {reconciliation.ordersWithPixel}
                  </Text>
                </BlockStack>
              </Box>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200" minWidth="140px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    差异率
                  </Text>
                  <Text as="p" variant="headingLg">
                    {reconciliation.discrepancyRate}%
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              统计区间：{typeof reconciliation.periodStart === "string" ? reconciliation.periodStart : new Date(reconciliation.periodStart).toISOString()} 至 {typeof reconciliation.periodEnd === "string" ? reconciliation.periodEnd : new Date(reconciliation.periodEnd).toISOString()}
            </Text>
          </BlockStack>
        </Card>
        {reconciliation.missingOrderIds.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                有订单无像素（丢单）
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "text"]}
                headings={["订单 ID", "金额", "币种"]}
                rows={reconciliation.missingOrderIds.slice(0, 100).map((r) => [
                  r.orderId,
                  String(r.totalPrice),
                  r.currency,
                ])}
              />
              {reconciliation.missingOrderIds.length > 100 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  仅展示前 100 条，完整列表请导出 CSV。
                </Text>
              )}
            </BlockStack>
          </Card>
        )}
        {reconciliation.valueMismatches.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                金额/币种不一致
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "text", "numeric", "text"]}
                headings={["订单 ID", "订单金额", "订单币种", "像素金额", "像素币种"]}
                rows={reconciliation.valueMismatches.slice(0, 50).map((r) => [
                  r.orderId,
                  String(r.orderValue),
                  r.orderCurrency,
                  String(r.pixelValue),
                  r.pixelCurrency,
                ])}
              />
              {reconciliation.valueMismatches.length > 50 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  仅展示前 50 条，完整列表请导出 CSV。
                </Text>
              )}
            </BlockStack>
          </Card>
        )}
        {reconciliation.totalOrders === 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                当前时间窗内暂无订单记录。请确认 orders/create webhook 已正常接收，或扩大时间窗。
              </Text>
              <Button url="/app/verification" variant="primary">
                返回验收页面
              </Button>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
