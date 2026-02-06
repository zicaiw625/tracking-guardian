import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Banner,
  List,
  Layout,
  Button,
} from "@shopify/polaris";
import { ClipboardIcon, ExportIcon } from "~/components/icons";
import { CheckoutExtensibilityWarning } from "~/components/verification/CheckoutExtensibilityWarning";
import { CheckoutCompletedBehaviorHint } from "~/components/verification/CheckoutCompletedBehaviorHint";
import { TestGuidePanel } from "~/components/verification/TestGuidePanel";
import type { TestChecklist } from "~/services/verification-checklist.server";
import { generateChecklistMarkdown, generateChecklistCSV } from "~/utils/verification-checklist";
import { useTranslation } from "react-i18next";

export interface VerificationIntroSectionProps {
  testGuide: { steps: Array<{ step: number; title: string; description: string }>; tips: string[]; estimatedTime: string };
  configuredPlatforms: string[];
  copyTestGuide: () => void;
  guideExpanded: boolean;
  onGuideExpandedChange: (expanded: boolean) => void;
  testChecklist: (Omit<TestChecklist, "generatedAt"> & { generatedAt: string | Date }) | null;
  showSuccess: (msg: string) => void;
  latestRun: { runId: string } | null;
  canExportReports: boolean;
  currentPlan: string | null;
}

export function VerificationIntroSection({
  testGuide,
  configuredPlatforms,
  copyTestGuide,
  guideExpanded,
  onGuideExpandedChange,
  testChecklist,
  showSuccess,
  latestRun,
  canExportReports,
  currentPlan,
}: VerificationIntroSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("verification.intro.title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("verification.intro.description")}
          </Text>
          <Layout>
            <Layout.Section variant="oneHalf">
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">
                      {t("verification.intro.pixelLayer.title")}
                    </Text>
                    <Badge tone="success">{t("verification.intro.allPlansAvailable")}</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm">
                    <strong>{t("verification.intro.scopeLabel")}</strong>{t("verification.intro.pixelLayer.scope")}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">{t("verification.intro.pixelLayer.item1")}</Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">{t("verification.intro.pixelLayer.item2")}</Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">{t("verification.intro.pixelLayer.item3")}</Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <strong>{t("verification.intro.supportedEventsLabel")}</strong>checkout_started, checkout_completed, checkout_contact_info_submitted, checkout_shipping_info_submitted, payment_info_submitted, product_added_to_cart, product_viewed, page_viewed
                  </Text>
                </BlockStack>
              </Box>
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">
                      {t("verification.intro.orderLayer.title")}
                    </Text>
                    <Badge tone="success">{t("verification.intro.allPlansAvailable")}</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm">
                    <strong>{t("verification.intro.scopeLabel")}</strong>{t("verification.intro.orderLayer.scope")}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">{t("verification.intro.orderLayer.item1")}</Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">{t("verification.intro.orderLayer.item2")}</Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">{t("verification.intro.orderLayer.item3")}</Text>
                    </List.Item>
                  </List>
                  <Button url="/app/verification/orders" variant="primary" size="slim">
                    {t("verification.intro.orderLayer.cta")}
                  </Button>
                </BlockStack>
              </Box>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </Card>
      <Banner title={t("verification.intro.v1Warning.title")} tone="warning">
        <BlockStack gap="300">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            <strong>{t("verification.intro.v1Warning.subtitle")}</strong>
          </Text>
          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>{t("verification.intro.v1Warning.supportedLabel")}</strong>{t("verification.intro.v1Warning.supportedContent")}
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>{t("verification.intro.v1Warning.unsupportedLabel")}</strong>{t("verification.intro.v1Warning.unsupportedContent")}
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>{t("verification.intro.v1Warning.noteLabel")}</strong>{t("verification.intro.v1Warning.noteContent")}
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>{t("verification.intro.v1Warning.reasonLabel")}</strong>{t("verification.intro.v1Warning.reasonContent")}
              </Text>
            </List.Item>
          </List>
          <Text as="p" variant="bodySm" tone="subdued">
            <strong>{t("verification.intro.v1Warning.attentionLabel")}</strong>{t("verification.intro.v1Warning.attentionContent")}
          </Text>
        </BlockStack>
      </Banner>
      <Banner tone="info" title={t("verification.intro.attribution.title")}>
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            <strong>{t("verification.intro.attribution.subtitle")}</strong>
          </Text>
          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodySm"><strong>{t("verification.intro.attribution.provideLabel")}</strong>{t("verification.intro.attribution.provideContent")}</Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm"><strong>{t("verification.intro.attribution.noGuaranteeLabel")}</strong>{t("verification.intro.attribution.noGuaranteeContent")}</Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm"><strong>{t("verification.intro.attribution.methodLabel")}</strong>{t("verification.intro.attribution.methodContent")}</Text>
            </List.Item>
          </List>
        </BlockStack>
      </Banner>
      <CheckoutExtensibilityWarning />
      {latestRun && !canExportReports && (
        <Banner
          title={t("verification.intro.upgradeBanner.title")}
          tone="warning"
          action={{ content: t("verification.intro.upgradeBanner.cta"), url: "/app/billing?upgrade=growth" }}
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              {t("verification.intro.upgradeBanner.content1")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("verification.intro.upgradeBanner.content2")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("verification.intro.upgradeBanner.content3")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("verification.intro.upgradeBanner.currentPlan")}<strong>{currentPlan === "free" ? t("subscriptionPlans.free") : currentPlan === "starter" ? t("subscriptionPlans.starter") : currentPlan}</strong>
            </Text>
          </BlockStack>
        </Banner>
      )}
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">{t("verification.intro.scope.title")}</Text>
          <Text as="p" variant="bodySm"><strong>{t("verification.intro.scope.subtitle")}</strong></Text>
          <List type="bullet">
            <List.Item>✅ <strong>{t("verification.intro.scope.item1Title")}</strong>：checkout_started, checkout_completed, product_added_to_cart, product_viewed, page_viewed</List.Item>
            <List.Item>❌ <strong>{t("verification.intro.scope.item2Title")}</strong>：{t("verification.intro.scope.item2Content")}</List.Item>
          </List>
          <Text as="p" variant="bodySm" tone="subdued">
            <strong>{t("verification.intro.v1Warning.reasonLabel")}</strong>{t("verification.intro.v1Warning.reasonContent")}
          </Text>
        </BlockStack>
      </Banner>
      <CheckoutCompletedBehaviorHint mode="info" collapsible={true} />
      <TestGuidePanel
        testGuide={testGuide}
        configuredPlatforms={configuredPlatforms}
        onCopyGuide={copyTestGuide}
        guideExpanded={guideExpanded}
        onGuideExpandedChange={onGuideExpandedChange}
      />
      {testChecklist && testChecklist.items.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{t("verification.intro.checklist.title")}</Text>
              <InlineStack gap="200">
                <Button
                  icon={ClipboardIcon}
                  size="slim"
                  onClick={() => {
                    const checklist: TestChecklist = { ...testChecklist, generatedAt: new Date(testChecklist.generatedAt) };
                    const markdown = generateChecklistMarkdown(checklist);
                    navigator.clipboard.writeText(markdown);
                    showSuccess(t("verification.intro.checklist.copySuccess"));
                  }}
                >
                  {t("verification.intro.checklist.copy")}
                </Button>
                <Button
                  icon={ExportIcon}
                  size="slim"
                  onClick={() => {
                    const checklist: TestChecklist = { ...testChecklist, generatedAt: new Date(testChecklist.generatedAt) };
                    const csv = generateChecklistCSV(checklist);
                    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `test-checklist-${new Date().toISOString().split("T")[0]}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showSuccess(t("verification.intro.checklist.exportSuccess"));
                  }}
                >
                  {t("verification.intro.checklist.export")}
                </Button>
              </InlineStack>
            </InlineStack>
            <BlockStack gap="200">
              <InlineStack gap="300" wrap>
                <Badge tone="info">{`${String(testChecklist.requiredItemsCount)} ${t("verification.intro.checklist.requiredCount")}`}</Badge>
                <Badge>{`${String(testChecklist.optionalItemsCount)} ${t("verification.intro.checklist.optionalCount")}`}</Badge>
                <Badge tone="success">{`${t("verification.intro.checklist.estimated")} ${String(Math.floor(testChecklist.totalEstimatedTime / 60))} ${t("common.hours")} ${String(testChecklist.totalEstimatedTime % 60)} ${t("common.minutes")}`}</Badge>
              </InlineStack>
            </BlockStack>
            <BlockStack gap="300">
              {testChecklist.items.map((item) => (
                <Box key={item.id} background={item.required ? "bg-fill-warning-secondary" : "bg-surface-secondary"} padding="400" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">{item.required ? "✅" : "⚪"} {item.name}</Text>
                          <Badge tone={item.required ? "warning" : "info"}>{item.required ? t("common.required") : t("common.optional")}</Badge>
                          <Badge>{item.category}</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">{item.description}</Text>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">{t("common.platform")} {item.platforms.join(", ")}</Text>
                          <Text as="span" variant="bodySm" tone="subdued">• {t("verification.intro.checklist.estimated")} {item.estimatedTime} {t("common.minutes")}</Text>
                        </InlineStack>
                      </BlockStack>
                    </InlineStack>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">{t("verification.intro.checklist.steps")}</Text>
                      <List type="number">
                        {item.steps.map((step, i) => (
                          <List.Item key={i}>
                            <Text as="span" variant="bodySm">{step.replace(/^\d+\.\s*/, "")}</Text>
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">{t("verification.intro.checklist.expectedResults")}</Text>
                      <List>
                        {item.expectedResults.map((result, i) => (
                          <List.Item key={i}>
                            <Text as="span" variant="bodySm">{result}</Text>
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}
      <Banner tone="info" title={t("verification.intro.attribution.title")}>
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            <strong>{t("verification.intro.attribution.subtitle")}</strong>
          </Text>
          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodySm"><strong>{t("verification.intro.attribution.provideLabel")}</strong>{t("verification.intro.attribution.provideContent")}</Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm"><strong>{t("verification.intro.attribution.noGuaranteeLabel")}</strong>{t("verification.intro.attribution.noGuaranteeContent")}</Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm"><strong>{t("verification.intro.attribution.methodLabel")}</strong>{t("verification.intro.attribution.methodContent")}</Text>
            </List.Item>
          </List>
        </BlockStack>
      </Banner>
    </>
  );
}
