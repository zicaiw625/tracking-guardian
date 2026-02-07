import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  List,
  Divider,
  Badge,
  Box,
} from "@shopify/polaris";
import { ClipboardIcon } from "~/components/icons";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { useToastContext } from "~/components/ui";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  generateTestChecklist,
  type PixelLayerItem,
  type OrderLayerItem,
} from "../services/verification-checklist.server";
import {
  generateChecklistMarkdown,
  generateChecklistCSV,
} from "../utils/verification-checklist";
import { VERIFICATION_TEST_ITEMS } from "../services/verification.server";
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
      testChecklist: null,
      testItems: VERIFICATION_TEST_ITEMS,
    });
  }
  const testChecklist = generateTestChecklist(shop.id, "quick");
  return json({
    shop: { id: shop.id, domain: shopDomain },
    testChecklist,
    testItems: VERIFICATION_TEST_ITEMS,
  });
};

export default function VerificationStartPage() {
  const { shop, testChecklist } = useLoaderData<typeof loader>();
  const { showSuccess, showError } = useToastContext();
  const { t } = useTranslation();

  if (!shop || !testChecklist) {
    return (
      <Page title={t("verification.start.pageTitle")}>
        <Banner tone="warning">
          <Text as="p">{t("verification.start.shopNotFound")}</Text>
        </Banner>
      </Page>
    );
  }
  const handleCopyChecklist = async () => {
    const markdown = generateChecklistMarkdown(testChecklist);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(markdown);
        showSuccess(t("verification.start.toast.copySuccess"));
      } catch {
        showError(t("verification.start.toast.copyFail"));
      }
    } else {
      showError(t("verification.start.toast.browserNotSupported"));
    }
  };
  const handleDownloadCSV = () => {
    const csv = generateChecklistCSV(testChecklist);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `verification-checklist-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };
  return (
    <Page
      title={t("verification.start.pageTitle")}
      subtitle={t("verification.start.subtitle")}
      backAction={{ content: t("verification.start.backAction"), url: "/app/verification" }}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title={t("verification.start.intro.title")}
          description={t("verification.start.intro.description")}
          items={t("verification.start.intro.items", { returnObjects: true }) as string[]}
          primaryAction={{ content: t("verification.start.backAction"), url: "/app/verification" }}
        />
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              {t("verification.start.banner.prdRequirement")}
            </Text>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {t("verification.start.checklist.title")}
              </Text>
              <InlineStack gap="200">
                <Button
                  icon={ClipboardIcon}
                  onClick={handleCopyChecklist}
                  size="slim"
                >
                  {t("verification.start.checklist.copy")}
                </Button>
                <Button onClick={handleDownloadCSV} size="slim">
                  {t("verification.start.checklist.downloadCSV")}
                </Button>
              </InlineStack>
            </InlineStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("verification.start.checklist.pixelLayerTitle")}
              </Text>
              <List type="number">
                {testChecklist.pixelLayer.map((item: PixelLayerItem, index: number) => (
                  <List.Item key={index}>
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {item.eventName}
                        </Text>
                        <Badge tone={item.required ? "critical" : "info"}>
                          {item.required ? t("verification.start.checklist.required") : t("verification.start.checklist.optional")}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.description}
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>{t("verification.start.checklist.verificationPoints")}</strong>
                        {item.verificationPoints.join("、")}
                      </Text>
                      {item.expectedParams && (
                        <Box
                          padding="300"
                          borderRadius="200"
                          background="bg-surface-secondary"
                        >
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            {t("verification.start.checklist.expectedParams")}
                          </Text>
                          <List type="bullet">
                            {item.expectedParams?.map((param: string, pIndex: number) => (
                              <List.Item key={pIndex}>
                                <Text as="span" variant="bodySm">
                                  {param}
                                </Text>
                              </List.Item>
                            ))}
                          </List>
                        </Box>
                      )}
                    </BlockStack>
                  </List.Item>
                ))}
              </List>
            </BlockStack>
            <Divider />
            {testChecklist.orderLayer.length > 0 && (
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  {t("verification.start.checklist.orderLayerTitle")}
                </Text>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    {t("verification.start.checklist.orderLayerBanner")}
                  </Text>
                </Banner>
              </BlockStack>
            )}
            {testChecklist?.orderLayer && (testChecklist?.orderLayer?.length ?? 0) > 0 && (
              <List type="number">
                {testChecklist?.orderLayer?.map((item: OrderLayerItem, index: number) => (
                  <List.Item key={index}>
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {item.eventType}
                        </Text>
                        <Badge tone={item.required ? "critical" : "info"}>
                          {item.required ? t("verification.start.checklist.required") : t("verification.start.checklist.optional")}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.description}
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>{t("verification.start.checklist.verificationPoints")}</strong>
                        {item.verificationPoints.join("、")}
                      </Text>
                      {item.expectedFields && (
                        <Box
                          padding="300"
                          borderRadius="200"
                          background="bg-surface-secondary"
                        >
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            {t("verification.start.checklist.expectedFields")}
                          </Text>
                          <List type="bullet">
                            {item.expectedFields?.map((field: string, fIndex: number) => (
                              <List.Item key={fIndex}>
                                <Text as="span" variant="bodySm">
                                  {field}
                                </Text>
                              </List.Item>
                            ))}
                          </List>
                        </Box>
                      )}
                    </BlockStack>
                  </List.Item>
                ))}
              </List>
            )}
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("verification.start.steps.title")}
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("verification.start.steps.step1")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("verification.start.steps.step2")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("verification.start.steps.step3")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("verification.start.steps.step4")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("verification.start.steps.step5")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("verification.start.steps.step6")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("verification.start.steps.step7")}
                  </Text>
                </List.Item>
              </List>
            </BlockStack>
            <Divider />
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {t("verification.start.nextStep")}
              </Text>
              <Button url="/app/verification" variant="primary">
                {t("verification.start.goToVerification")}
              </Button>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
