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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const { shop, reconciliation, hours, pcdDisabled } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const HOUR_OPTIONS = [
    { label: t("verification.orders.overview.options.24h"), value: "24" },
    { label: t("verification.orders.overview.options.72h"), value: "72" },
    { label: t("verification.orders.overview.options.7d"), value: "168" },
  ];

  const handleHoursChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("hours", value);
    setSearchParams(next);
  };

  if (!shop) {
    return (
      <Page title={t("verification.orders.title")}>
        <Banner tone="warning">
          <Text as="p">{t("verification.orders.shopNotFound")}</Text>
        </Banner>
        <Button url="/app/verification" variant="primary">
          {t("verification.orders.returnToVerification")}
        </Button>
      </Page>
    );
  }

  if (pcdDisabled) {
    return (
      <Page title={t("verification.orders.title")} backAction={{ content: t("verification.orders.backAction"), url: "/app/verification" }}>
        <BlockStack gap="400">
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("verification.orders.pcdDisabled.title")}
              </Text>
              <Text as="p" variant="bodySm">
                {t("verification.orders.pcdDisabled.desc")}
              </Text>
            </BlockStack>
          </Banner>
          <Button url="/app/verification" variant="primary">
            {t("verification.orders.returnToVerification")}
          </Button>
        </BlockStack>
      </Page>
    );
  }

  if (!reconciliation) {
    return (
      <Page title={t("verification.orders.title")}>
        <Banner tone="warning">
          <Text as="p">{t("verification.orders.shopNotFound")}</Text>
        </Banner>
        <Button url="/app/verification" variant="primary">
          {t("verification.orders.returnToVerification")}
        </Button>
      </Page>
    );
  }

  const exportUrl = `/api/verification-orders-report.csv?hours=${hours}`;

  return (
    <Page
      title={t("verification.orders.title")}
      backAction={{ content: t("verification.orders.backAction"), url: "/app/verification" }}
      primaryAction={{
        content: t("verification.orders.export"),
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
                {t("verification.orders.overview.title")}
              </Text>
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("verification.orders.overview.timeWindow")}
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
                    {t("verification.orders.overview.totalOrders")}
                  </Text>
                  <Text as="p" variant="headingLg">
                    {reconciliation.totalOrders}
                  </Text>
                </BlockStack>
              </Box>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200" minWidth="140px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("verification.orders.overview.ordersWithPixel")}
                  </Text>
                  <Text as="p" variant="headingLg">
                    {reconciliation.ordersWithPixel}
                  </Text>
                </BlockStack>
              </Box>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200" minWidth="140px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("verification.orders.overview.discrepancyRate")}
                  </Text>
                  <Text as="p" variant="headingLg">
                    {reconciliation.discrepancyRate}%
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("verification.orders.overview.period", { 
                start: typeof reconciliation.periodStart === "string" ? reconciliation.periodStart : new Date(reconciliation.periodStart).toISOString(),
                end: typeof reconciliation.periodEnd === "string" ? reconciliation.periodEnd : new Date(reconciliation.periodEnd).toISOString()
              })}
            </Text>
          </BlockStack>
        </Card>
        {reconciliation.missingOrderIds.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("verification.orders.missingOrders.title")}
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "text"]}
                headings={[t("verification.orders.missingOrders.table.orderId"), t("verification.orders.missingOrders.table.amount"), t("verification.orders.missingOrders.table.currency")]}
                rows={reconciliation.missingOrderIds.slice(0, 100).map((r) => [
                  r.orderId,
                  String(r.totalPrice),
                  r.currency,
                ])}
              />
              {reconciliation.missingOrderIds.length > 100 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("verification.orders.missingOrders.more")}
                </Text>
              )}
            </BlockStack>
          </Card>
        )}
        {reconciliation.valueMismatches.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("verification.orders.valueMismatch.title")}
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "text", "numeric", "text"]}
                headings={[
                  t("verification.orders.valueMismatch.table.orderId"), 
                  t("verification.orders.valueMismatch.table.orderValue"), 
                  t("verification.orders.valueMismatch.table.orderCurrency"), 
                  t("verification.orders.valueMismatch.table.pixelValue"), 
                  t("verification.orders.valueMismatch.table.pixelCurrency")
                ]}
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
                  {t("verification.orders.valueMismatch.more")}
                </Text>
              )}
            </BlockStack>
          </Card>
        )}
        {reconciliation.totalOrders === 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                {t("verification.orders.noOrders")}
              </Text>
              <Button url="/app/verification" variant="primary">
                {t("verification.orders.returnToVerification")}
              </Button>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
