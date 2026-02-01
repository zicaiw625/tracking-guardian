import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  BlockStack,
  Text,
  Checkbox,
  TextField,
  Banner,
  List,
  Box,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import { useTranslation } from "react-i18next";

interface GuidedSupplementProps {
  open: boolean;
  onClose: () => void;
  shopId: string;
  onComplete: (count: number) => void;
}

type AuditAssetInput = {
  sourceType: "api_scan" | "manual_paste" | "merchant_confirmed";
  category: "pixel" | "affiliate" | "survey" | "support" | "analytics" | "other";
  platform?: string;
  displayName?: string;
  riskLevel?: "high" | "medium" | "low";
  suggestedMigration?: "web_pixel" | "ui_extension" | "server_side" | "none";
  details?: Record<string, unknown>;
};

const FEATURE_TO_PLATFORM: Record<string, string | undefined> = {
  google_analytics: "google-analytics",
  meta_pixel: "facebook-pixel",
  tiktok_pixel: "tiktok",
  pinterest_tag: "pinterest",
  snapchat_pixel: "snapchat",
  microsoft_ads: "bing",
  twitter_pixel: "twitter",
  linkedin_tag: "linkedin",
  custom_pixel: undefined,
};

export function GuidedSupplement({
  open,
  onClose,
  shopId: _shopId,
  onComplete,
}: GuidedSupplementProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{
    success?: boolean;
    actionType?: string;
    created?: number;
    error?: string;
  }>();

  const [step, setStep] = useState(1);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [extraInfo, setExtraInfo] = useState("");

  const UPGRADE_WIZARD_CHECKLIST = useMemo(
    () => [
      { id: "google_analytics", label: t("scan.upgradeWizardChecklist.google_analytics") },
      { id: "meta_pixel", label: t("scan.upgradeWizardChecklist.meta_pixel") },
      { id: "tiktok_pixel", label: t("scan.upgradeWizardChecklist.tiktok_pixel") },
      { id: "pinterest_tag", label: t("scan.upgradeWizardChecklist.pinterest_tag") },
      { id: "snapchat_pixel", label: t("scan.upgradeWizardChecklist.snapchat_pixel") },
      { id: "microsoft_ads", label: t("scan.upgradeWizardChecklist.microsoft_ads") },
      { id: "twitter_pixel", label: t("scan.upgradeWizardChecklist.twitter_pixel") },
      { id: "linkedin_tag", label: t("scan.upgradeWizardChecklist.linkedin_tag") },
      { id: "custom_pixel", label: t("scan.upgradeWizardChecklist.custom_pixel") },
    ],
    [t]
  );

  const resetState = () => {
    setStep(1);
    setSelectedFeatures([]);
    setPastedText("");
    setExtraInfo("");
  };

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open]);

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (fetcher.data?.success && fetcher.data.actionType === "create_from_wizard") {
      onComplete(fetcher.data.created ?? 0);
      resetState();
      onClose();
    }
  }, [fetcher.state, fetcher.data, onComplete, onClose]);

  const handleFeatureToggle = (id: string) => {
    setSelectedFeatures((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  };

  const handlePaste = (value: string) => {
    setPastedText(value);
    const lower = value.toLowerCase();
    const detected: string[] = [];

    if (lower.includes("google") || lower.includes("ga4")) detected.push("google_analytics");
    if (lower.includes("meta") || lower.includes("facebook")) detected.push("meta_pixel");
    if (lower.includes("tiktok")) detected.push("tiktok_pixel");
    if (lower.includes("pinterest")) detected.push("pinterest_tag");
    if (lower.includes("snapchat")) detected.push("snapchat_pixel");
    if (lower.includes("microsoft") || lower.includes("bing")) detected.push("microsoft_ads");
    if (lower.includes("twitter") || lower.includes("x pixel")) detected.push("twitter_pixel");
    if (lower.includes("linkedin")) detected.push("linkedin_tag");

    if (detected.length > 0) {
      setSelectedFeatures((prev) => Array.from(new Set([...prev, ...detected])));
    }
  };

  const handleNext = () => setStep((s) => s + 1);
  const handleBack = () => setStep((s) => s - 1);
  const handleSubmit = () => {
    const assets: AuditAssetInput[] = selectedFeatures.map((featureId) => {
      const platform = FEATURE_TO_PLATFORM[featureId];
      const displayName =
        UPGRADE_WIZARD_CHECKLIST.find((item) => item.id === featureId)?.label ?? featureId;
      const isCustom = featureId === "custom_pixel";

      return {
        sourceType: "merchant_confirmed",
        category: isCustom ? "other" : "pixel",
        ...(platform ? { platform } : {}),
        displayName,
        riskLevel: "medium",
        suggestedMigration: isCustom ? "ui_extension" : "web_pixel",
        details: {
          fromWizard: true,
          fromUpgradeWizard: true,
          extraInfo: extraInfo.trim() || undefined,
          pastedText: pastedText.trim() || undefined,
        },
      };
    });

    if (assets.length === 0) {
      onComplete(0);
      resetState();
      onClose();
      return;
    }

    const formData = new FormData();
    formData.append("_action", "create_from_wizard");
    formData.append("assets", JSON.stringify(assets));
    fetcher.submit(formData, { method: "post" });
  };

  const isStep1Valid = selectedFeatures.length > 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        resetState();
        onClose();
      }}
      title={t("scan.guidedSupplement.title")}
      primaryAction={{
        content: step === 3 ? t("scan.guidedSupplement.actions.finish") : t("scan.guidedSupplement.actions.next"),
        onAction: step === 3 ? handleSubmit : handleNext,
        disabled: step === 1 && !isStep1Valid,
        loading: step === 3 && fetcher.state !== "idle",
      }}
      secondaryActions={[
        {
          content: step === 1 ? t("scan.guidedSupplement.actions.cancel") : t("scan.guidedSupplement.actions.prev"),
          onAction: step === 1 ? onClose : handleBack,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodySm" tone="subdued">
            {t("scan.guidedSupplement.step", { step })}
          </Text>

          {step === 1 && (
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  {t("scan.guidedSupplement.checklist.title")}
                </Text>
                <Text as="p" variant="bodyMd">
                  {t("scan.guidedSupplement.checklist.desc")}
                </Text>
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      {t("scan.guidedSupplement.checklist.howTo")}
                    </Text>
                    <List type="number">
                      <List.Item>
                        {t("scan.guidedSupplement.checklist.howToStep")}
                      </List.Item>
                    </List>
                  </BlockStack>
                </Box>
              </BlockStack>
              
              <Banner tone="info">
                <p>
                  <strong>{t("scan.guidedSupplement.checklist.v1Desc")}</strong> {t("scan.guidedSupplement.checklist.selectLabel")}
                </p>
              </Banner>

              <BlockStack gap="200">
                {UPGRADE_WIZARD_CHECKLIST.map((item) => (
                  <Checkbox
                    key={item.id}
                    label={item.label}
                    checked={selectedFeatures.includes(item.id)}
                    onChange={() => handleFeatureToggle(item.id)}
                  />
                ))}
              </BlockStack>

              {!isStep1Valid && (
                <Text as="p" tone="critical" variant="bodySm">
                  {t("scan.guidedSupplement.checklist.validation")}
                </Text>
              )}
            </BlockStack>
          )}

          {step === 2 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("scan.guidedSupplement.supplement.title")}
              </Text>
              <Text as="p" variant="bodyMd">
                {t("scan.guidedSupplement.supplement.desc")}
              </Text>

              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="400">
                  <Text as="p" fontWeight="semibold">
                    {t("scan.guidedSupplement.supplement.methods")}
                  </Text>
                  
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      {t("scan.guidedSupplement.supplement.method1")}
                    </Text>
                    <InlineStack gap="200" wrap>
                      {selectedFeatures.length > 0 ? (
                        selectedFeatures.map(f => {
                            const label = UPGRADE_WIZARD_CHECKLIST.find(i => i.id === f)?.label || f;
                            return <Badge key={f} tone="info">{label}</Badge>;
                        })
                      ) : (
                        <Text as="span" tone="subdued">{t("scan.guidedSupplement.summary.none")}</Text>
                      )}
                    </InlineStack>
                  </BlockStack>

                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      {t("scan.guidedSupplement.supplement.method2")}
                    </Text>
                    <TextField
                      label={t("scan.guidedSupplement.supplement.pasteLabel")}
                      value={pastedText}
                      onChange={(value) => handlePaste(String(value))}
                      multiline={4}
                      autoComplete="off"
                      placeholder={t("scan.guidedSupplement.supplement.placeholder")}
                      helpText={t("scan.guidedSupplement.supplement.autoMatch")}
                    />
                  </BlockStack>
                </BlockStack>
              </Box>
              
              <Banner tone="success">
                <p>{t("scan.guidedSupplement.supplement.tip")}</p>
              </Banner>
            </BlockStack>
          )}

          {step === 3 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("scan.guidedSupplement.summary.title")}
              </Text>
              
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      {t("scan.guidedSupplement.summary.manual")}
                    </Text>
                    <InlineStack gap="200" wrap>
                      {selectedFeatures.length > 0 ? (
                        selectedFeatures.map((f) => {
                          const label = UPGRADE_WIZARD_CHECKLIST.find((i) => i.id === f)?.label || f;
                          return (
                            <Badge key={f} tone="success">
                              {label}
                            </Badge>
                          );
                        })
                      ) : (
                        <Text as="span" tone="subdued">
                          {t("scan.guidedSupplement.summary.none")}
                        </Text>
                      )}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("scan.guidedSupplement.summary.source")}
                    </Text>
                  </BlockStack>

                  <BlockStack gap="200">
                    <TextField
                      label={t("scan.guidedSupplement.extra.label")}
                      value={extraInfo}
                      onChange={(value) => setExtraInfo(String(value))}
                      multiline={3}
                      autoComplete="off"
                      placeholder={t("scan.guidedSupplement.extra.placeholder")}
                      helpText={t("scan.guidedSupplement.extra.help")}
                    />
                  </BlockStack>
                </BlockStack>
              </Box>

              <Banner tone="success">
                <p>{t("scan.guidedSupplement.summary.success")}</p>
              </Banner>
            </BlockStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
