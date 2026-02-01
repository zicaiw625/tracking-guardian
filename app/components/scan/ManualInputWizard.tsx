import { useState, useCallback } from "react";
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
} from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { useTranslation, Trans } from "react-i18next";

export interface ManualInputWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: (data: ManualInputData) => void;
}

export interface ManualInputData {
  platforms: string[];
  features: string[];
  additionalInfo?: string;
  fromUpgradeWizard?: boolean;
}

const AVAILABLE_PLATFORMS = [
  { value: "google", labelKey: "scan.manualInput.platforms.google" },
  { value: "meta", labelKey: "scan.manualInput.platforms.meta" },
  { value: "tiktok", labelKey: "scan.manualInput.platforms.tiktok" },
  { value: "other", labelKey: "scan.manualInput.platforms.other" },
];

const AVAILABLE_FEATURES = [
  { value: "survey", labelKey: "scan.manualInput.features.survey" },
  { value: "support", labelKey: "scan.manualInput.features.support" },
  { value: "reorder", labelKey: "scan.manualInput.features.reorder" },
  { value: "affiliate", labelKey: "scan.manualInput.features.affiliate" },
  { value: "upsell", labelKey: "scan.manualInput.features.upsell" },
  { value: "tracking", labelKey: "scan.manualInput.features.tracking" },
  { value: "other", labelKey: "scan.manualInput.features.other" },
];

export function ManualInputWizard({ open, onClose, onComplete }: ManualInputWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [fromUpgradeWizard, setFromUpgradeWizard] = useState(false);
  const handlePlatformToggle = useCallback((platform: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  }, []);
  const handleFeatureToggle = useCallback((feature: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]
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
  const handleComplete = useCallback(() => {
    onComplete({
      platforms: selectedPlatforms,
      features: selectedFeatures,
      additionalInfo: additionalInfo.trim() || undefined,
      fromUpgradeWizard,
    });
    setStep(1);
    setSelectedPlatforms([]);
    setSelectedFeatures([]);
    setAdditionalInfo("");
    setFromUpgradeWizard(false);
    onClose();
  }, [selectedPlatforms, selectedFeatures, additionalInfo, fromUpgradeWizard, onComplete, onClose]);
  const handleCancel = useCallback(() => {
    setStep(1);
    setSelectedPlatforms([]);
    setSelectedFeatures([]);
    setAdditionalInfo("");
    setFromUpgradeWizard(false);
    onClose();
  }, [onClose]);
  const canProceedFromStep1 = selectedPlatforms.length > 0 || selectedFeatures.length > 0;
  const canProceedFromStep2 = true;
  const canComplete = selectedPlatforms.length > 0 || selectedFeatures.length > 0;
  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={t("scan.manualInput.title")}
      primaryAction={
        step === 3
          ? {
              content: t("scan.manualInput.actions.complete"),
              onAction: handleComplete,
              disabled: !canComplete,
            }
          : {
              content: t("scan.manualInput.actions.next"),
              onAction: handleNext,
              disabled: step === 1 ? !canProceedFromStep1 : !canProceedFromStep2,
            }
      }
      secondaryActions={[
        ...(step > 1 ? [{ content: t("scan.manualInput.actions.back"), onAction: handleBack }] : []),
        { content: t("scan.manualInput.actions.cancel"), onAction: handleCancel },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineStack gap="200" align="center">
            <Badge tone={step >= 1 ? "success" : "info"}>{t("scan.manualInput.step1")}</Badge>
            <Text as="span">→</Text>
            <Badge tone={step >= 2 ? "success" : step > 2 ? "info" : undefined}>{t("scan.manualInput.step2")}</Badge>
            <Text as="span">→</Text>
            <Badge tone={step >= 3 ? "success" : undefined}>{t("scan.manualInput.step3")}</Badge>
          </InlineStack>
          {step === 1 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("scan.manualInput.platforms.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scan.manualInput.platforms.description")}
              </Text>
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="scan.manualInput.platforms.v1Support" components={{ strong: <strong /> }} />
                </Text>
              </Banner>
              <BlockStack gap="300">
                {AVAILABLE_PLATFORMS.filter((platform) => {
                  return platform.value === "google" || platform.value === "meta" || platform.value === "tiktok" || platform.value === "other";
                }).map((platform) => {
                  const isV1Supported =
                    platform.value === "google" ||
                    platform.value === "meta" ||
                    platform.value === "tiktok";
                  return (
                    <InlineStack key={platform.value} gap="200" blockAlign="center">
                      <Checkbox
                        label={t(platform.labelKey)}
                        checked={selectedPlatforms.includes(platform.value)}
                        onChange={() => handlePlatformToggle(platform.value)}
                      />
                      {isV1Supported && (
                        <Badge tone="success" size="small">{t("scan.manualInput.platforms.v1Supported")}</Badge>
                      )}
                      {!isV1Supported && platform.value !== "other" && (
                        <Badge tone="info" size="small">{t("scan.manualInput.platforms.v11Plus")}</Badge>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>
              <Divider />
              <Text as="h3" variant="headingMd">
                {t("scan.manualInput.features.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scan.manualInput.features.description")}
              </Text>
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="scan.manualInput.features.v1Support" components={{ strong: <strong /> }} />
                </Text>
              </Banner>
              <BlockStack gap="300">
                {AVAILABLE_FEATURES.map((feature) => {
                  const isV1Supported = false;
                  return (
                    <InlineStack key={feature.value} gap="200" blockAlign="center">
                      <Checkbox
                        label={t(feature.labelKey)}
                        checked={selectedFeatures.includes(feature.value)}
                        onChange={() => handleFeatureToggle(feature.value)}
                      />
                      {isV1Supported && (
                        <Badge tone="success" size="small">{t("scan.manualInput.platforms.v1Supported")}</Badge>
                      )}
                      {!isV1Supported && (
                        <Badge tone="info" size="small">{t("scan.manualInput.platforms.v11Plus")}</Badge>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>
              {selectedPlatforms.length === 0 && selectedFeatures.length === 0 && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    {t("scan.manualInput.validation.selectOne")}
                  </Text>
                </Banner>
              )}
            </BlockStack>
          )}
          {step === 2 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("scan.manualInput.source.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scan.manualInput.source.description")}
              </Text>
              <Checkbox
                label={t("scan.manualInput.source.fromUpgradeWizard")}
                checked={fromUpgradeWizard}
                onChange={(checked) => setFromUpgradeWizard(checked)}
                helpText={t("scan.manualInput.source.fromUpgradeWizardHelp")}
              />
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("scan.manualInput.source.guideTitle")}
                  </Text>
                  <List type="number">
                    {[0, 1, 2, 3].map(i => (
                      <List.Item key={i}>
                        {t(`scan.manualInput.source.guideSteps.${i}`)}
                      </List.Item>
                    ))}
                  </List>
                  <Divider />
                  <Text as="p" variant="bodySm" tone="subdued">
                    <Trans i18nKey="scan.manualInput.source.hint" components={{ strong: <strong /> }} />
                  </Text>
                  <List>
                    <List.Item>
                      {t("scan.manualInput.source.hintList.0")}
                    </List.Item>
                    <List.Item>
                      {t("scan.manualInput.source.hintList.1")}
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
            </BlockStack>
          )}
          {step === 3 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("scan.manualInput.additionalInfo.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scan.manualInput.additionalInfo.description")}
              </Text>
              <TextField
                label={t("scan.manualInput.additionalInfo.label")}
                value={additionalInfo}
                onChange={setAdditionalInfo}
                multiline={4}
                autoComplete="off"
                placeholder={t("scan.manualInput.additionalInfo.placeholder")}
                helpText={t("scan.manualInput.additionalInfo.helpText")}
              />
              <Divider />
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("scan.manualInput.summary.title")}
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack gap="200" align="start">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("scan.manualInput.summary.selectedPlatforms")}
                      </Text>
                      {selectedPlatforms.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {selectedPlatforms.map((p) => {
                            const platform = AVAILABLE_PLATFORMS.find((pl) => pl.value === p);
                            return (
                              <Badge key={p}>{platform ? t(platform.labelKey) : p}</Badge>
                            );
                          })}
                        </InlineStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t("scan.manualInput.summary.none")}
                        </Text>
                      )}
                    </InlineStack>
                    <InlineStack gap="200" align="start">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("scan.manualInput.summary.selectedFeatures")}
                      </Text>
                      {selectedFeatures.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {selectedFeatures.map((f) => {
                            const feature = AVAILABLE_FEATURES.find((fe) => fe.value === f);
                            return (
                              <Badge key={f}>{feature ? t(feature.labelKey) : f}</Badge>
                            );
                          })}
                        </InlineStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t("scan.manualInput.summary.none")}
                        </Text>
                      )}
                    </InlineStack>
                    {fromUpgradeWizard && (
                      <InlineStack gap="200" align="center">
                        <CheckCircleIcon />
                        <Text as="span" variant="bodySm">
                          {t("scan.manualInput.summary.fromUpgradeWizard")}
                        </Text>
                      </InlineStack>
                    )}
                  </BlockStack>
                </BlockStack>
              </Box>
            </BlockStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
