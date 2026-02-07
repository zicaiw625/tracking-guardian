import { useState, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  List,
  Badge,
  Box,
  Divider,
  Banner,
  ProgressBar,
} from "@shopify/polaris";
import { CheckCircleIcon, PlayIcon } from "~/components/icons";
import type { TestChecklist } from "~/services/verification-checklist.server";
import { CheckoutCompletedBehaviorHint } from "./CheckoutCompletedBehaviorHint";
import { useTranslation, Trans } from "react-i18next";

export interface VerificationWizardProps {
  shopId: string;
  testChecklist: TestChecklist;
  onStartTest?: () => void;
  onComplete?: () => void;
}

export function VerificationWizard({
  shopId: _shopId,
  testChecklist,
  onStartTest,
  onComplete,
}: VerificationWizardProps) {
  const { t } = useTranslation();
  const [completedItems, setCompletedItems] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = localStorage.getItem(`verification_wizard_${_shopId}`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const handleItemComplete = useCallback((itemId: string) => {
    setCompletedItems((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      if (typeof window !== "undefined") {
        localStorage.setItem(`verification_wizard_${_shopId}`, JSON.stringify(Array.from(next)));
      }
      return next;
    });
  }, [_shopId]);
  const progress = testChecklist.items.length > 0
    ? (completedItems.size / testChecklist.items.length) * 100
    : 0;
  const allCompleted = completedItems.size === testChecklist.items.length;
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text variant="headingMd" as="h2">
              {t("verification.wizard.title")}
            </Text>
            <Badge tone={allCompleted ? "success" : "info"}>
              {`${completedItems.size} / ${testChecklist.items.length}`}
            </Badge>
          </InlineStack>
          <Box>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span">
                  {t("verification.wizard.progress")}
                </Text>
                <Text variant="headingSm" as="span">
                  {Math.round(progress)}%
                </Text>
              </InlineStack>
              <ProgressBar progress={progress} size="small" />
            </BlockStack>
          </Box>
          <Divider />
          <Banner tone="info" title={t("verification.wizard.banner.title")}>
            <BlockStack gap="200">
              <Text variant="bodySm" as="p">
                <Trans i18nKey="verification.wizard.banner.scope" components={{ strong: <strong /> }} />
              </Text>
              <List type="bullet">
                <List.Item>{t("verification.wizard.banner.items.checkout_started")}</List.Item>
                <List.Item>{t("verification.wizard.banner.items.checkout_completed")}</List.Item>
                <List.Item>{t("verification.wizard.banner.items.checkout_contact_info_submitted")}</List.Item>
                <List.Item>{t("verification.wizard.banner.items.checkout_shipping_info_submitted")}</List.Item>
                <List.Item>{t("verification.wizard.banner.items.payment_info_submitted")}</List.Item>
                <List.Item>{t("verification.wizard.banner.items.product_added_to_cart")}</List.Item>
                <List.Item>{t("verification.wizard.banner.items.product_viewed")}</List.Item>
                <List.Item>{t("verification.wizard.banner.items.page_viewed")}</List.Item>
              </List>
              <Text variant="bodySm" as="p" tone="critical">
                <Trans i18nKey="verification.wizard.banner.unsupported" components={{ strong: <strong /> }} />
              </Text>
              <Text variant="bodySm" as="p">
                <Trans i18nKey="verification.wizard.banner.reason" components={{ strong: <strong /> }} />
              </Text>
              <Text variant="bodySm" as="p">
                <Trans i18nKey="verification.wizard.banner.trigger" components={{ strong: <strong /> }} />
              </Text>
              <Text variant="bodySm" as="p">
                <Trans i18nKey="verification.wizard.banner.consent" components={{ strong: <strong /> }} />
              </Text>
            </BlockStack>
          </Banner>
          <CheckoutCompletedBehaviorHint mode="info" collapsible={true} />
          <BlockStack gap="300">
            <Text variant="headingSm" as="h3">
              {t("verification.wizard.checklist.title")}
            </Text>
            <List>
              {testChecklist.items.map((item, index) => {
                const isCompleted = completedItems.has(item.id);
                return (
                  <List.Item key={item.id}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <InlineStack gap="200" blockAlign="center">
                          {isCompleted ? (
                            <CheckCircleIcon />
                          ) : (
                            <Box minWidth="20px" />
                          )}
                          <Text
                            variant="bodyMd"
                            as="span"
                            fontWeight={isCompleted ? "regular" : "semibold"}
                          >
                            {index + 1}. {item.name}
                          </Text>
                        </InlineStack>
                        {isCompleted && <Badge tone="success">{t("verification.wizard.status.completed")}</Badge>}
                      </InlineStack>
                      {item.description && (
                        <Text variant="bodySm" as="span" tone="subdued">
                          {item.description}
                        </Text>
                      )}
                      {item.expectedResults && item.expectedResults.length > 0 && (
                        <Box>
                          <Text variant="bodySm" as="span" fontWeight="semibold">
                            {t("verification.wizard.expectedResult")}
                          </Text>
                          <InlineStack gap="100">
                            {item.expectedResults.map((result) => (
                              <Badge key={result} tone="info">
                                {result}
                              </Badge>
                            ))}
                          </InlineStack>
                        </Box>
                      )}
                      {!isCompleted && (
                        <Button
                          size="slim"
                          onClick={() => handleItemComplete(item.id)}
                        >
                          {t("verification.wizard.actions.markComplete")}
                        </Button>
                      )}
                    </BlockStack>
                  </List.Item>
                );
              })}
            </List>
          </BlockStack>
          {allCompleted && (
            <Banner tone="success">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="span" fontWeight="semibold">
                  {t("verification.wizard.completion.title")}
                </Text>
                <Text variant="bodySm" as="span">
                  {t("verification.wizard.completion.desc")}
                </Text>
              </BlockStack>
            </Banner>
          )}
          <Divider />
          <InlineStack align="end">
            {onStartTest && (
              <Button onClick={onStartTest} icon={PlayIcon}>
                {t("verification.wizard.actions.startTest")}
              </Button>
            )}
            {allCompleted && onComplete && (
              <Button onClick={onComplete} variant="primary">
                {t("verification.wizard.actions.finish")}
              </Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
