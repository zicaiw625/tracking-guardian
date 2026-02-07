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
  { value: "google" },
  { value: "meta" },
  { value: "tiktok" },
  { value: "other" },
];

const AVAILABLE_FEATURES = [
  { value: "survey" },
  { value: "support" },
  { value: "reorder" },
  { value: "affiliate" },
  { value: "upsell" },
  { value: "tracking" },
  { value: "other" },
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

  const getPlatformLabel = (value: string) => {
    return t(`manualInputWizard.platforms.${value}`);
  };

  const getFeatureLabel = (value: string) => {
    return t(`manualInputWizard.features.${value}`);
  };

  const canProceedFromStep1 = selectedPlatforms.length > 0 || selectedFeatures.length > 0;
  const canProceedFromStep2 = true;
  const canComplete = selectedPlatforms.length > 0 || selectedFeatures.length > 0;
  
  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={t("manualInputWizard.title")}
      primaryAction={
        step === 3
          ? {
              content: t("manualInputWizard.actions.complete"),
              onAction: handleComplete,
              disabled: !canComplete,
            }
          : {
              content: t("manualInputWizard.actions.next"),
              onAction: handleNext,
              disabled: step === 1 ? !canProceedFromStep1 : !canProceedFromStep2,
            }
      }
      secondaryActions={[
        ...(step > 1 ? [{ content: t("manualInputWizard.actions.back"), onAction: handleBack }] : []),
        { content: t("manualInputWizard.actions.cancel"), onAction: handleCancel },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineStack gap="200" align="center">
            <Badge tone={step >= 1 ? "success" : "info"}>{t("newPixelWizard.stepIndicator", { current: 1, total: 3 }).split('/')[0].trim()}</Badge>
            <Text as="span">→</Text>
            <Badge tone={step >= 2 ? "success" : step > 2 ? "info" : undefined}>{t("newPixelWizard.stepIndicator", { current: 2, total: 3 }).split('/')[0].trim()}</Badge>
            <Text as="span">→</Text>
            <Badge tone={step >= 3 ? "success" : undefined}>{t("newPixelWizard.stepIndicator", { current: 3, total: 3 }).split('/')[0].trim()}</Badge>
          </InlineStack>
          {step === 1 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("manualInputWizard.steps.platform")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("manualInputWizard.steps.platformDesc")}
              </Text>
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="manualInputWizard.banners.platformV1" components={{ strong: <strong /> }} />
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
                        label={getPlatformLabel(platform.value)}
                        checked={selectedPlatforms.includes(platform.value)}
                        onChange={() => handlePlatformToggle(platform.value)}
                      />
                      {isV1Supported && (
                        <Badge tone="success" size="small">{t("newPixelWizard.selectStep.v1Support.badge")}</Badge>
                      )}
                      {!isV1Supported && platform.value !== "other" && (
                        <Badge tone="info" size="small">v1.1+</Badge>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>
              <Divider />
              <Text as="h3" variant="headingMd">
                {t("manualInputWizard.steps.feature")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("manualInputWizard.steps.featureDesc")}
              </Text>
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="manualInputWizard.banners.featureV1" components={{ strong: <strong /> }} />
                </Text>
              </Banner>
              <BlockStack gap="300">
                {AVAILABLE_FEATURES.map((feature) => {
                  const isV1Supported = false;
                  return (
                    <InlineStack key={feature.value} gap="200" blockAlign="center">
                      <Checkbox
                        label={getFeatureLabel(feature.value)}
                        checked={selectedFeatures.includes(feature.value)}
                        onChange={() => handleFeatureToggle(feature.value)}
                      />
                      {isV1Supported && (
                        <Badge tone="success" size="small">{t("newPixelWizard.selectStep.v1Support.badge")}</Badge>
                      )}
                      {!isV1Supported && (
                        <Badge tone="info" size="small">v1.1+</Badge>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>
              {selectedPlatforms.length === 0 && selectedFeatures.length === 0 && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    {t("manualInputWizard.banners.selectOne")}
                  </Text>
                </Banner>
              )}
            </BlockStack>
          )}
          {step === 2 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("manualInputWizard.steps.source")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("manualInputWizard.steps.sourceDesc")}
              </Text>
              <Checkbox
                label={t("manualInputWizard.labels.fromUpgradeWizard")}
                checked={fromUpgradeWizard}
                onChange={(checked) => setFromUpgradeWizard(checked)}
                helpText={t("manualInputWizard.labels.fromUpgradeWizardHelp")}
              />
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("manualInputWizard.banners.sourceHint")}
                  </Text>
                  <List type="number">
                    <List.Item>
                      {t("manualInputWizard.sourceSteps.step1")}
                    </List.Item>
                    <List.Item>
                      {t("manualInputWizard.sourceSteps.step2")}
                    </List.Item>
                    <List.Item>
                      {t("manualInputWizard.sourceSteps.step3")}
                    </List.Item>
                    <List.Item>
                      {t("manualInputWizard.sourceSteps.step4")}
                    </List.Item>
                  </List>
                  <Divider />
                  <Text as="p" variant="bodySm" tone="subdued">
                    <Trans i18nKey="manualInputWizard.banners.sourceTip" components={{ strong: <strong /> }} />
                  </Text>
                  <List>
                    <List.Item>
                      {t("manualInputWizard.sourceTips.tip1")}
                    </List.Item>
                    <List.Item>
                      {t("manualInputWizard.sourceTips.tip2")}
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
            </BlockStack>
          )}
          {step === 3 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                {t("manualInputWizard.steps.additional")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("manualInputWizard.steps.additionalDesc")}
              </Text>
              <TextField
                label={t("manualInputWizard.labels.additionalInput")}
                value={additionalInfo}
                onChange={setAdditionalInfo}
                multiline={4}
                autoComplete="off"
                placeholder={t("manualInputWizard.labels.additionalPlaceholder")}
                helpText={t("manualInputWizard.labels.additionalHelp")}
              />
              <Divider />
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("manualInputWizard.summary.title")}
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack gap="200" align="start">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("manualInputWizard.summary.platforms")}
                      </Text>
                      {selectedPlatforms.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {selectedPlatforms.map((p) => {
                            return (
                              <Badge key={p}>{getPlatformLabel(p)}</Badge>
                            );
                          })}
                        </InlineStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t("manualInputWizard.summary.none")}
                        </Text>
                      )}
                    </InlineStack>
                    <InlineStack gap="200" align="start">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("manualInputWizard.summary.features")}
                      </Text>
                      {selectedFeatures.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {selectedFeatures.map((f) => {
                            return (
                              <Badge key={f}>{getFeatureLabel(f)}</Badge>
                            );
                          })}
                        </InlineStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t("manualInputWizard.summary.none")}
                        </Text>
                      )}
                    </InlineStack>
                    {fromUpgradeWizard && (
                      <InlineStack gap="200" align="center">
                        <CheckCircleIcon />
                        <Text as="span" variant="bodySm">
                          {t("manualInputWizard.summary.fromWizard")}
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
