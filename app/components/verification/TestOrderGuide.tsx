import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  List,
  Collapsible,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ClipboardIcon,
  RefreshIcon,
} from "../icons";
import { useState, useCallback, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { CheckoutCompletedBehaviorHint } from "./CheckoutCompletedBehaviorHint";

export interface TestOrderGuideProps {
  shopDomain: string;
  shopId: string;
  testItems: Array<{
    id: string;
    name: string;
    description: string;
    steps: string[];
    expectedEvents: string[];
    eventType?: string;
    category?: string;
  }>;
  onTestComplete?: (itemId: string, verified: boolean) => void;
}

export function TestOrderGuide({
  shopDomain,
  shopId: _shopId,
  testItems,
  onTestComplete,
}: TestOrderGuideProps) {
  const { t } = useTranslation();
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [testStatuses, setTestStatuses] = useState<Record<string, "pending" | "verifying" | "verified" | "failed">>({});
  const [verificationResults, setVerificationResults] = useState<Record<string, {
    verified: boolean;
    eventsFound: number;
    expectedEvents: number;
    missingEvents: string[];
    errors?: string[];
  }>>({});
  const fetcher = useFetcher();
  const handleCopy = useCallback(async (text: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(itemId);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch (error) {
      const { debugError } = await import("../../utils/debug-log.client");
      debugError("Failed to copy:", error);
    }
  }, []);
  const toggleExpanded = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);
  const handleVerifyTest = useCallback((itemId: string) => {
    const item = testItems.find((i) => i.id === itemId);
    if (!item) return;
    setTestStatuses((prev) => ({ ...prev, [itemId]: "verifying" }));
    const formData = new FormData();
    formData.append("_action", "verifyTestItem");
    formData.append("itemId", itemId);
    formData.append("eventType", item.eventType || "purchase");
    formData.append("expectedEvents", JSON.stringify(item.expectedEvents));
    fetcher.submit(formData, { method: "post" });
  }, [testItems, fetcher]);
  useEffect(() => {
    if (fetcher.data && (fetcher.data as { success?: boolean; itemId?: string }).success) {
      const data = fetcher.data as {
        itemId: string;
        verified: boolean;
        eventsFound: number;
        expectedEvents: number;
        missingEvents: string[];
        errors?: string[];
      };
      setTestStatuses((prev) => ({
        ...prev,
        [data.itemId]: data.verified ? "verified" : "failed",
      }));
      setVerificationResults((prev) => ({
        ...prev,
        [data.itemId]: {
          verified: data.verified,
          eventsFound: data.eventsFound,
          expectedEvents: data.expectedEvents,
          missingEvents: data.missingEvents,
          errors: data.errors,
        },
      }));
      if (onTestComplete) {
        onTestComplete(data.itemId, data.verified);
      }
    }
  }, [fetcher.data, onTestComplete]);
  const testStoreUrl = `https://${shopDomain}`;
  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            📋 {t("verification.guide.title")}
          </Text>
          <Text as="p" tone="subdued">
            {t("verification.guide.subtitle")}
          </Text>
        </BlockStack>
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("verification.guide.quickStart.title")}
            </Text>
            <List type="bullet">
              <List.Item>
                {t("verification.guide.quickStart.step1")}
              </List.Item>
              <List.Item>
                {t("verification.guide.quickStart.step2")}
              </List.Item>
              <List.Item>
                {t("verification.guide.quickStart.step3")}
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>{t("verification.guide.references.title")}</strong>
              <br />
              • <a href="https://help.shopify.com/en/manual/checkout-settings/test-orders" target="_blank" rel="noopener noreferrer">{t("verification.guide.references.checkout")}</a>
              <br />
              • <a href="https://help.shopify.com/en/manual/promoting-marketing/pixels/custom-pixels/testing" target="_blank" rel="noopener noreferrer">{t("verification.guide.references.pixels")}</a>
            </Text>
          </BlockStack>
        </Banner>
        <Divider />
        <BlockStack gap="400">
          {testItems.map((item) => {
            const isExpanded = expandedItems.has(item.id);
            const isCopied = copiedItem === item.id;
            return (
              <Card key={item.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {item.name}
                        </Text>
                        <Badge tone="info">{t("verification.guide.testScenario")}</Badge>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {item.description}
                      </Text>
                    </BlockStack>
                    <Button
                      size="slim"
                      variant="plain"
                      onClick={() => toggleExpanded(item.id)}
                    >
                      {isExpanded ? t("verification.guide.collapse") : t("verification.guide.expand")}
                    </Button>
                  </InlineStack>
                  <Collapsible
                    open={isExpanded}
                    id={`test-item-${item.id}`}
                    transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                  >
                    <BlockStack gap="300">
                      <Divider />
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h4" variant="headingSm">
                            {t("verification.guide.steps.title")}
                          </Text>
                          <Button
                            size="slim"
                            variant="plain"
                            icon={ClipboardIcon}
                            onClick={() => {
                              const stepsText = item.steps.map((step, idx) => `${idx + 1}. ${step}`).join("\n");
                              handleCopy(stepsText, `${item.id}-steps`);
                            }}
                          >
                            {t("verification.guide.steps.copyAll")}
                          </Button>
                        </InlineStack>
                        <List type="number">
                          {item.steps.map((step, idx) => (
                            <List.Item key={idx}>
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span">{step}</Text>
                                <Button
                                  size="micro"
                                  variant="plain"
                                  icon={ClipboardIcon}
                                  onClick={() => handleCopy(step, `${item.id}-step-${idx}`)}
                                >
                                  {t("verification.guide.steps.copy")}
                                </Button>
                              </InlineStack>
                            </List.Item>
                          ))}
                        </List>
                      </BlockStack>
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h4" variant="headingSm">
                            {t("verification.guide.expectedEvents.title")}
                          </Text>
                          <Button
                            size="slim"
                            variant="secondary"
                            icon={RefreshIcon}
                            onClick={() => handleVerifyTest(item.id)}
                            loading={testStatuses[item.id] === "verifying"}
                            disabled={testStatuses[item.id] === "verifying"}
                          >
                            {testStatuses[item.id] === "verifying"
                              ? t("verification.guide.expectedEvents.verifying")
                              : testStatuses[item.id] === "verified"
                                ? t("verification.guide.expectedEvents.verified")
                                : testStatuses[item.id] === "failed"
                                  ? t("verification.guide.expectedEvents.failed")
                                  : t("verification.guide.expectedEvents.autoVerify")}
                          </Button>
                        </InlineStack>
                        <InlineStack gap="100" wrap>
                          {item.expectedEvents.map((event) => {
                            const result = verificationResults[item.id];
                            const isFound = result?.missingEvents
                              ? !result.missingEvents.includes(event)
                              : undefined;
                            return (
                              <Badge
                                key={event}
                                tone={
                                  isFound === true
                                    ? "success"
                                    : isFound === false
                                      ? "critical"
                                      : "info"
                                }
                              >
                                {`${event}${isFound === true ? " ✓" : isFound === false ? " ✗" : ""}`}
                              </Badge>
                            );
                          })}
                        </InlineStack>
                        {verificationResults[item.id] && (
                          <Box
                            background={
                              verificationResults[item.id].verified
                                ? "bg-surface-success"
                                : "bg-surface-critical"
                            }
                            padding="300"
                            borderRadius="200"
                          >
                            <BlockStack gap="200">
                              <InlineStack align="space-between" blockAlign="center">
                                <Text as="span" variant="bodySm" fontWeight="semibold">
                                  {t("verification.title")}
                                </Text>
                                <Badge
                                  tone={
                                    verificationResults[item.id].verified
                                      ? "success"
                                      : "critical"
                                  }
                                >
                                  {verificationResults[item.id].verified
                                    ? t("verification.guide.results.verified")
                                    : t("verification.guide.results.failed")}
                                </Badge>
                              </InlineStack>
                              <Text as="span" variant="bodySm">
                                {t("verification.guide.results.summary", { found: verificationResults[item.id].eventsFound, expected: verificationResults[item.id].expectedEvents })}
                              </Text>
                              {verificationResults[item.id].missingEvents.length > 0 && (
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    {t("verification.guide.results.missing")}
                                  </Text>
                                  <List type="bullet">
                                    {verificationResults[item.id].missingEvents.map(
                                      (event, idx) => (
                                        <List.Item key={idx}>{event}</List.Item>
                                      )
                                    )}
                                  </List>
                                  {verificationResults[item.id].missingEvents.some(
                                    (e) => e.toLowerCase().includes("checkout_completed") || e.toLowerCase().includes("purchase")
                                  ) && (
                                    <CheckoutCompletedBehaviorHint mode="missing" collapsible={true} />
                                  )}
                                </BlockStack>
                              )}
                              {verificationResults[item.id].errors &&
                                verificationResults[item.id].errors!.length > 0 && (
                                  <BlockStack gap="200">
                                    <Banner tone="critical">
                                      <List type="bullet">
                                        {verificationResults[item.id].errors!.map((err, idx) => (
                                          <List.Item key={idx}>{err}</List.Item>
                                        ))}
                                      </List>
                                    </Banner>
                                    {verificationResults[item.id].missingEvents.some(
                                      (e) => e.toLowerCase().includes("checkout_completed") || e.toLowerCase().includes("purchase")
                                    ) && (
                                      <CheckoutCompletedBehaviorHint mode="missing" collapsible={true} />
                                    )}
                                  </BlockStack>
                                )}
                            </BlockStack>
                          </Box>
                        )}
                      </BlockStack>
                      <Box
                        background="bg-surface-secondary"
                        padding="300"
                        borderRadius="200"
                      >
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {t("verification.guide.storeLink.title")}
                            </Text>
                            <Button
                              size="slim"
                              variant="plain"
                              icon={isCopied ? CheckCircleIcon : ClipboardIcon}
                              onClick={() => handleCopy(testStoreUrl, item.id)}
                            >
                              {isCopied ? t("verification.guide.storeLink.copied") : t("verification.guide.storeLink.copy")}
                            </Button>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {testStoreUrl}
                          </Text>
                        </BlockStack>
                      </Box>
                    </BlockStack>
                  </Collapsible>
                </BlockStack>
              </Card>
            );
          })}
        </BlockStack>
        <Divider />
        <Banner tone="warning">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              ⚠️ {t("verification.guide.warnings.title")}
            </Text>
            <List type="bullet">
              <List.Item>
                {t("verification.guide.warnings.item1")}
              </List.Item>
              <List.Item>
                {t("verification.guide.warnings.item2")}
              </List.Item>
              <List.Item>
                {t("verification.guide.warnings.item3")}
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Card>
  );
}
