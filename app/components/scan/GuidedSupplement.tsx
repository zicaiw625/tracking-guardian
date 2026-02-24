import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Checkbox,
  TextField,
  Banner,
  List,
  Divider,
  Box,
  Badge,
  Card,
} from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { useFetcher } from "@remix-run/react";

export interface GuidedSupplementProps {
  open: boolean;
  onClose: () => void;
  onComplete?: (count: number) => void;
  shopId: string;
}

const UPGRADE_WIZARD_CHECKLIST = [
  { id: "ga4", labelKey: "guidedSupplement.checklist.ga4", category: "pixel", platform: "google" },
  { id: "meta", labelKey: "guidedSupplement.checklist.meta", category: "pixel", platform: "meta" },
  { id: "tiktok", labelKey: "guidedSupplement.checklist.tiktok", category: "pixel", platform: "tiktok" },
  { id: "survey", labelKey: "guidedSupplement.checklist.survey", category: "survey", platform: undefined },
  { id: "support", labelKey: "guidedSupplement.checklist.support", category: "support", platform: undefined },
  { id: "reorder", labelKey: "guidedSupplement.checklist.reorder", category: "other", platform: undefined },
  { id: "affiliate", labelKey: "guidedSupplement.checklist.affiliate", category: "affiliate", platform: undefined },
  { id: "tracking", labelKey: "guidedSupplement.checklist.tracking", category: "support", platform: undefined },
  { id: "other", labelKey: "guidedSupplement.checklist.other", category: "other", platform: undefined },
];

export function GuidedSupplement({
  open,
  onClose,
  onComplete,
  shopId: _shopId,
}: GuidedSupplementProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const fetcher = useFetcher();
  const handleItemToggle = useCallback((itemId: string) => {
    setSelectedItems((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  }, []);
  const handleNext = useCallback(() => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  }, [step]);
  const handleBack = useCallback(() => {
    if (step === 2) {
      setStep(1);
    } else if (step === 3) {
      setStep(2);
    }
  }, [step]);
  const extractFeaturesFromText = useCallback((text: string): string[] => {
    const lowerText = text.toLowerCase();
    const detectedItems: string[] = [];
    const keywordMap: Record<string, string[]> = {
      ga4: ["ga4", "google analytics 4", "g-"],
      google: ["google analytics", "gtag", "google tag"],
      meta: ["meta pixel", "facebook pixel", "fbq", "fb pixel"],
      tiktok: ["tiktok pixel", "ttq", "tiktok"],
      pinterest: ["pinterest tag", "pintrk", "pinterest"],
      snapchat: ["snapchat pixel", "snaptr", "snapchat"],
      survey: ["survey", "问卷", "评价", "feedback", "fairing", "zigpoll"],
      support: ["support", "客服", "helpdesk", "zendesk", "intercom"],
      reorder: ["reorder", "再购", "再次购买"],
      affiliate: ["affiliate", "联盟", "referral", "commission"],
      upsell: ["upsell", "追加销售", "推荐商品"],
      tracking: ["tracking", "追踪", "物流", "aftership", "17track"],
    };
    Object.entries(keywordMap).forEach(([key, keywords]) => {
      if (keywords.some(kw => lowerText.includes(kw))) {
        const itemId = key === "ga4" ? "ga4" :
                      key === "google" ? "ga4" :
                      key === "meta" ? "meta" :
                      key === "tiktok" ? "tiktok" :
                      key === "pinterest" ? "pinterest" :
                      key === "snapchat" ? "snapchat" :
                      key === "survey" ? "survey" :
                      key === "support" ? "support" :
                      key === "reorder" ? "reorder" :
                      key === "affiliate" ? "affiliate" :
                      key === "upsell" ? "upsell" :
                      key === "tracking" ? "tracking" : null;
        if (itemId && !detectedItems.includes(itemId)) {
          detectedItems.push(itemId);
        }
      }
    });
    return detectedItems;
  }, []);
  const handleComplete = useCallback(() => {
    if (selectedItems.length === 0) {
      return;
    }
    const finalSelectedItems = [...selectedItems];
    if (additionalNotes.trim()) {
      const detectedItems = extractFeaturesFromText(additionalNotes);
      detectedItems.forEach(itemId => {
        if (!finalSelectedItems.includes(itemId)) {
          finalSelectedItems.push(itemId);
        }
      });
    }
    const assets = finalSelectedItems.map((itemId) => {
      const item = UPGRADE_WIZARD_CHECKLIST.find((i) => i.id === itemId);
      if (!item) return null;
      return {
        sourceType: "merchant_confirmed" as const,
        category: item.category as
          | "pixel"
          | "affiliate"
          | "survey"
          | "support"
          | "analytics"
          | "other",
        platform: item.platform,
        displayName: t(item.labelKey),
        riskLevel: item.category === "pixel" ? ("high" as const) : ("medium" as const),
        suggestedMigration:
          item.category === "pixel"
            ? ("web_pixel" as const)
            : item.category === "survey" || item.category === "support"
              ? ("ui_extension" as const)
              : item.category === "affiliate"
                ? ("server_side" as const)
                : ("none" as const),
        details: {
          fromUpgradeWizard: true,
          additionalNotes: additionalNotes.trim() || undefined,
          autoDetected: !selectedItems.includes(itemId),
        },
      };
    }).filter((asset): asset is NonNullable<typeof asset> => asset !== null);
    fetcher.submit(
      {
        _action: "create_from_wizard",
        assets: JSON.stringify(assets),
      },
      { method: "post" }
    );
  }, [selectedItems, additionalNotes, fetcher, extractFeaturesFromText, t]);
  if (fetcher.data && (fetcher.data as { success?: boolean }).success) {
    const result = fetcher.data as { created?: number; updated?: number };
    const totalCreated = (result.created || 0) + (result.updated || 0);
    if (onComplete && totalCreated > 0) {
      setTimeout(() => {
        onComplete(totalCreated);
        setStep(1);
        setSelectedItems([]);
        setAdditionalNotes("");
        onClose();
      }, 1000);
    }
  }
  const handleCancel = useCallback(() => {
    setStep(1);
    setSelectedItems([]);
    setAdditionalNotes("");
    onClose();
  }, [onClose]);
  const canProceedFromStep1 = selectedItems.length > 0;
  const canProceedFromStep2 = true;
  const canComplete = selectedItems.length > 0;
  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={t("guidedSupplement.modal.title")}
      primaryAction={
        step === 3
          ? {
              content: t("guidedSupplement.modal.complete"),
              onAction: handleComplete,
              disabled: !canComplete || fetcher.state === "submitting",
              loading: fetcher.state === "submitting",
            }
          : {
              content: t("guidedSupplement.modal.next"),
              onAction: handleNext,
              disabled: step === 1 ? !canProceedFromStep1 : !canProceedFromStep2,
            }
      }
      secondaryActions={[
        ...(step > 1 ? [{ content: t("guidedSupplement.modal.back"), onAction: handleBack }] : []),
        { content: t("guidedSupplement.modal.cancel"), onAction: handleCancel },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineStack gap="200" align="center">
            <Badge tone={step >= 1 ? "success" : "info"}>{t("guidedSupplement.steps.step1")}</Badge>
            <Text as="span">→</Text>
            <Badge tone={step >= 2 ? "success" : step > 2 ? "info" : undefined}>{t("guidedSupplement.steps.step2")}</Badge>
            <Text as="span">→</Text>
            <Badge tone={step >= 3 ? "success" : undefined}>{t("guidedSupplement.steps.step3")}</Badge>
          </InlineStack>
          {step === 1 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("guidedSupplement.step1.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("guidedSupplement.step1.description")}
              </Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("guidedSupplement.step1.guideTitle")}
                  </Text>
                  <List type="number">
                    <List.Item>
                      {t("guidedSupplement.step1.guideStep1")}
                    </List.Item>
                    <List.Item>
                      {t("guidedSupplement.step1.guideStep2")}
                    </List.Item>
                    <List.Item>
                      {t("guidedSupplement.step1.guideStep3")}
                    </List.Item>
                    <List.Item>
                      {t("guidedSupplement.step1.guideStep4")}
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
              <Banner tone="warning">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("guidedSupplement.step1.v1ScopeTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("guidedSupplement.step1.v1PixelSupport")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("guidedSupplement.step1.v1UiModules")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("guidedSupplement.step1.v1SelectAll")}
                  </Text>
                </BlockStack>
              </Banner>
              <BlockStack gap="300">
                {UPGRADE_WIZARD_CHECKLIST.map((item) => {
                  const isV1Supported =
                    item.id === "ga4" || item.id === "meta" || item.id === "tiktok";
                  return (
                    <Box
                      key={item.id}
                      background={
                        selectedItems.includes(item.id) ? "bg-surface-success" : "bg-surface-secondary"
                      }
                      padding="300"
                      borderRadius="200"
                    >
                      <InlineStack gap="200" blockAlign="center">
                        <Checkbox
                          label={t(item.labelKey)}
                          checked={selectedItems.includes(item.id)}
                          onChange={() => handleItemToggle(item.id)}
                        />
                        {isV1Supported && (
                          <Badge tone="success" size="small">{t("guidedSupplement.step1.v1Supported")}</Badge>
                        )}
                        {!isV1Supported && (item.category === "pixel" || item.category === "survey" || item.category === "support") && (
                          <Badge tone="info" size="small">v1.1+</Badge>
                        )}
                      </InlineStack>
                    </Box>
                  );
                })}
              </BlockStack>
              {selectedItems.length === 0 && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    {t("guidedSupplement.step1.emptySelection")}
                  </Text>
                </Banner>
              )}
            </BlockStack>
          )}
          {step === 2 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("guidedSupplement.step2.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("guidedSupplement.step2.description")}
              </Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("guidedSupplement.step2.methodsTitle")}
                  </Text>
                  <List>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        {t("guidedSupplement.step2.method1")}
                      </Text>
                    </List.Item>
                    <List.Item>
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t("guidedSupplement.step2.method2")}
                        </Text>
                        <Badge tone="info" size="small">{t("guidedSupplement.step2.comingSoon")}</Badge>
                      </InlineStack>
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
              <Card>
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("guidedSupplement.step2.pasteTitle")}
                  </Text>
                  <TextField
                    label={t("guidedSupplement.step2.pasteLabel")}
                    value={additionalNotes}
                    onChange={setAdditionalNotes}
                    multiline={6}
                    placeholder={t("guidedSupplement.step2.pastePlaceholder")}
                    helpText={t("guidedSupplement.step2.pasteHelpText")}
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
              <Banner>
                <Text as="p" variant="bodySm">
                  {t("guidedSupplement.step2.tip")}
                </Text>
              </Banner>
              <Card>
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("guidedSupplement.step2.selectedTitle")}
                  </Text>
                  <InlineStack gap="100" wrap>
                    {selectedItems.map((itemId) => {
                      const item = UPGRADE_WIZARD_CHECKLIST.find((i) => i.id === itemId);
                      return item ? <Badge key={itemId}>{t(item.labelKey)}</Badge> : null;
                    })}
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          )}
          {step === 3 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("guidedSupplement.step3.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("guidedSupplement.step3.description")}
              </Text>
              <TextField
                label={t("guidedSupplement.step3.notesLabel")}
                value={additionalNotes}
                onChange={setAdditionalNotes}
                multiline={4}
                placeholder={t("guidedSupplement.step3.notesPlaceholder")}
                helpText={t("guidedSupplement.step3.notesHelpText")}
                autoComplete="off"
              />
              <Divider />
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("guidedSupplement.step3.summaryTitle")}
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack gap="200" align="start">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("guidedSupplement.step3.manuallySelected")}
                      </Text>
                      {selectedItems.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {selectedItems.map((itemId) => {
                            const item = UPGRADE_WIZARD_CHECKLIST.find((i) => i.id === itemId);
                            return item ? (
                              <Badge key={itemId} tone="info">{t(item.labelKey)}</Badge>
                            ) : null;
                          })}
                        </InlineStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t("guidedSupplement.step3.none")}
                        </Text>
                      )}
                    </InlineStack>
                    {additionalNotes.trim() && (() => {
                      const detectedItems = extractFeaturesFromText(additionalNotes);
                      const autoDetected = detectedItems.filter(id => !selectedItems.includes(id));
                      return autoDetected.length > 0 ? (
                        <InlineStack gap="200" align="start">
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {t("guidedSupplement.step3.autoDetected")}
                          </Text>
                          <InlineStack gap="100" wrap>
                            {autoDetected.map((itemId) => {
                              const item = UPGRADE_WIZARD_CHECKLIST.find((i) => i.id === itemId);
                              return item ? (
                                <Badge key={itemId} tone="success">{t(item.labelKey)}</Badge>
                              ) : null;
                            })}
                          </InlineStack>
                        </InlineStack>
                      ) : null;
                    })()}
                    <InlineStack gap="200" align="center">
                      <CheckCircleIcon />
                      <Text as="span" variant="bodySm">
                        {t("guidedSupplement.step3.sourceInfo")}
                        {additionalNotes.trim() && t("guidedSupplement.step3.sourceInfoWithText")}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Box>
              {fetcher.data && (fetcher.data as { error?: string }).error ? (
                <Banner tone="critical">
                  <Text as="p" variant="bodySm">
                    {(fetcher.data as { error: string }).error}
                  </Text>
                </Banner>
              ) : null}
              {fetcher.data && (fetcher.data as { success?: boolean }).success ? (
                <Banner tone="success">
                  <Text as="p" variant="bodySm">
                    {t("guidedSupplement.step3.successMessage")}
                  </Text>
                </Banner>
              ) : null}
            </BlockStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
