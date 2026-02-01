import {
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Select,
  Divider,
  Banner,
  Badge,
  Box,
  List,
  Modal,
} from "@shopify/polaris";
import { useSubmit } from "@remix-run/react";
import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";

interface ShopData {
  id: string;
  domain: string;
  plan: string;
  hasIngestionSecret: boolean;
  hasActiveGraceWindow: boolean;
  graceWindowExpiry: Date | string | null;
  hasExpiredPreviousSecret: boolean;
  consentStrategy: string;
  dataRetentionDays: number;
}

interface SecurityTabProps {
  shop: ShopData | null;
  isSubmitting: boolean;
  onRotateSecret: () => void;
  pixelStrictOrigin?: boolean;
  hmacSecurityStats?: {
    lastRotationAt: Date | string | null;
    rotationCount: number;
    graceWindowActive: boolean;
    graceWindowExpiry: Date | string | null;
    suspiciousActivityCount: number;
    lastSuspiciousActivity: Date | string | null;
    nullOriginRequestCount: number;
    invalidSignatureCount: number;
    lastInvalidSignature: Date | string | null;
  } | null;
}

export function SecurityTab({
  shop,
  isSubmitting,
  onRotateSecret,
  pixelStrictOrigin,
  hmacSecurityStats,
}: SecurityTabProps) {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [pendingConsentStrategy, setPendingConsentStrategy] = useState<string | null>(null);
  const [showRotateModal, setShowRotateModal] = useState(false);

  const handleDataRetentionChange = (value: string) => {
    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("consentStrategy", shop?.consentStrategy || "balanced");
    formData.append("dataRetentionDays", value);
    submit(formData, { method: "post" });
  };

  const handleConsentStrategyChange = (value: string) => {
    if (value !== "strict") {
      setPendingConsentStrategy(value);
      setShowConsentModal(true);
      return;
    }
    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("consentStrategy", value);
    formData.append("dataRetentionDays", String(shop?.dataRetentionDays || 90));
    submit(formData, { method: "post" });
  };

  const confirmConsentStrategyChange = () => {
    if (!pendingConsentStrategy) {
      setShowConsentModal(false);
      return;
    }
    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("consentStrategy", pendingConsentStrategy);
    formData.append("dataRetentionDays", String(shop?.dataRetentionDays || 90));
    submit(formData, { method: "post" });
    setShowConsentModal(false);
    setPendingConsentStrategy(null);
  };

  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("Settings.Security.Title")}
            </Text>
            <Text as="p" tone="subdued">
              {t("Settings.Security.Description")}
            </Text>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("Settings.Security.IngestionKey.Title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("Settings.Security.IngestionKey.Description")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                <Trans i18nKey="Settings.Security.IngestionKey.Benefits" />
              </Text>
              <Text as="p" variant="bodySm" tone="caution">
                {t("Settings.Security.IngestionKey.SecurityNote")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                <Trans i18nKey="Settings.Security.IngestionKey.SecurityLayers" />
              </Text>
              <Text as="p" variant="bodySm" tone="caution">
                 <Trans i18nKey="Settings.Security.IngestionKey.BoundaryNote" />
              </Text>
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      {t("Settings.Security.IngestionKey.Status")}
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      {shop?.hasIngestionSecret ? (
                        <>
                          <Badge tone="success">{t("Settings.Security.IngestionKey.Configured")}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {t("Settings.Security.IngestionKey.TokenConfigured")}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Badge tone="attention">{t("Settings.Security.IngestionKey.NotConfigured")}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {t("Settings.Security.IngestionKey.ReinstallPrompt")}
                          </Text>
                        </>
                      )}
                    </InlineStack>
                  </BlockStack>
                  <Button
                    variant="secondary"
                    onClick={() => setShowRotateModal(true)}
                    loading={isSubmitting}
                  >
                    {shop?.hasIngestionSecret 
                      ? t("Settings.Security.IngestionKey.RotateToken")
                      : t("Settings.Security.IngestionKey.GenerateToken")}
                  </Button>
                </InlineStack>
              </Box>
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    {t("Settings.Security.IngestionKey.EventMode")}
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={pixelStrictOrigin ? "success" : "warning"}>
                      {pixelStrictOrigin 
                        ? t("Settings.Security.IngestionKey.Strict")
                        : t("Settings.Security.IngestionKey.Lax")}
                    </Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {pixelStrictOrigin 
                        ? t("Settings.Security.IngestionKey.StrictDesc")
                        : t("Settings.Security.IngestionKey.LaxDesc")}
                    </Text>
                  </InlineStack>
                  {!pixelStrictOrigin && (
                    <Text as="p" variant="bodySm" tone="caution">
                      <Trans i18nKey="Settings.Security.IngestionKey.LaxWarning" />
                    </Text>
                  )}
                </BlockStack>
              </Box>
              {shop?.hasActiveGraceWindow && shop.graceWindowExpiry && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <Trans 
                        i18nKey="Settings.Security.IngestionKey.GraceWindow" 
                        values={{ date: new Date(shop.graceWindowExpiry).toLocaleString() }} 
                      />
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("Settings.Security.IngestionKey.GraceWindowEnd")}
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              {shop?.hasExpiredPreviousSecret && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <Trans i18nKey="Settings.Security.IngestionKey.OldTokenExpired" />
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              {hmacSecurityStats && (
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">
                      {t("Settings.Security.HMAC.Title")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("Settings.Security.HMAC.Description")}
                    </Text>
                    <Divider />
                    <BlockStack gap="300">
                      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {t("Settings.Security.HMAC.RotationStatus")}
                            </Text>
                            <Button
                              variant="plain"
                              size="slim"
                              onClick={() => setShowRotateModal(true)}
                              loading={isSubmitting}
                            >
                              {t("Settings.Security.HMAC.RotateNow")}
                            </Button>
                          </InlineStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              {t("Settings.Security.HMAC.LastRotation")}
                            </Text>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {hmacSecurityStats.lastRotationAt 
                                ? new Date(hmacSecurityStats.lastRotationAt).toLocaleString()
                                : t("Settings.Security.HMAC.NeverRotated")}
                            </Text>
                          </InlineStack>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              {t("Settings.Security.HMAC.RotationCount")}
                            </Text>
                            <Badge tone={hmacSecurityStats.rotationCount > 0 ? "success" : "info"}>
                              {String(hmacSecurityStats.rotationCount)}
                            </Badge>
                          </InlineStack>
                          {hmacSecurityStats.graceWindowActive && hmacSecurityStats.graceWindowExpiry && (
                            <Banner tone="info">
                              <Text as="p" variant="bodySm">
                                {t("Settings.Security.HMAC.GraceWindowActive", { date: new Date(hmacSecurityStats.graceWindowExpiry).toLocaleString() })}
                              </Text>
                            </Banner>
                          )}
                          {!hmacSecurityStats.lastRotationAt && (
                            <Banner tone="warning">
                              <BlockStack gap="200">
                                <Text as="p" variant="bodySm" fontWeight="semibold">
                                  {t("Settings.Security.HMAC.RotationAdviceTitle")}
                                </Text>
                                <Text as="p" variant="bodySm">
                                  {t("Settings.Security.HMAC.RotationAdviceDesc")}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {t("Settings.Security.HMAC.RotationAdviceTip")}
                                </Text>
                                <Text as="p" variant="bodySm" tone="critical">
                                  <Trans i18nKey="Settings.Security.HMAC.RotationWarning" />
                                </Text>
                              </BlockStack>
                            </Banner>
                          )}
                          {hmacSecurityStats.lastRotationAt && (() => {
                            const daysSinceRotation = Math.floor((Date.now() - new Date(hmacSecurityStats.lastRotationAt).getTime()) / (1000 * 60 * 60 * 24));
                            if (daysSinceRotation >= 90) {
                              return (
                                <Banner tone="warning">
                                  <BlockStack gap="200">
                                    <Text as="p" variant="bodySm" fontWeight="semibold">
                                      {t("Settings.Security.HMAC.OverdueWarningTitle")}
                                    </Text>
                                    <Text as="p" variant="bodySm">
                                      {t("Settings.Security.HMAC.OverdueWarningDesc", { 
                                        date: new Date(hmacSecurityStats.lastRotationAt).toLocaleString(),
                                        days: daysSinceRotation
                                      })}
                                    </Text>
                                    <Text as="p" variant="bodySm" tone="critical">
                                      <Trans i18nKey="Settings.Security.HMAC.RotationWarning" />
                                    </Text>
                                  </BlockStack>
                                </Banner>
                              );
                            }
                            return null;
                          })()}
                        </BlockStack>
                      </Box>
                      <Divider />
                      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                        <BlockStack gap="300">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            {t("Settings.Security.HMAC.SuspiciousInjection")}
                          </Text>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              {t("Settings.Security.HMAC.InvalidSignatures")}
                            </Text>
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={hmacSecurityStats.invalidSignatureCount > 0 ? "critical" : "success"}>
                                {String(hmacSecurityStats.invalidSignatureCount)}
                              </Badge>
                              {hmacSecurityStats.invalidSignatureCount > 0 && hmacSecurityStats.lastInvalidSignature && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  (Recent: {new Date(hmacSecurityStats.lastInvalidSignature).toLocaleString()})
                                </Text>
                              )}
                            </InlineStack>
                          </InlineStack>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              {t("Settings.Security.HMAC.NullOriginRequests")}
                            </Text>
                            <Badge tone={hmacSecurityStats.nullOriginRequestCount > 10 ? "warning" : "success"}>
                              {String(hmacSecurityStats.nullOriginRequestCount)}
                            </Badge>
                          </InlineStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {t("Settings.Security.HMAC.SuspiciousTotal")}
                            </Text>
                            <Badge tone={hmacSecurityStats.suspiciousActivityCount > 10 ? "critical" : hmacSecurityStats.suspiciousActivityCount > 0 ? "warning" : "success"}>
                              {String(hmacSecurityStats.suspiciousActivityCount)}
                            </Badge>
                          </InlineStack>
                          {hmacSecurityStats.suspiciousActivityCount > 0 && hmacSecurityStats.lastSuspiciousActivity && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("Settings.Security.HMAC.LastSuspicious", { date: new Date(hmacSecurityStats.lastSuspiciousActivity).toLocaleString() })}
                            </Text>
                          )}
                        </BlockStack>
                      </Box>
                      {hmacSecurityStats.suspiciousActivityCount > 10 && (
                        <Banner tone="critical">
                          <BlockStack gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {t("Settings.Security.HMAC.HighSuspiciousAlert")}
                            </Text>
                            <Text as="p" variant="bodySm">
                              {t("Settings.Security.HMAC.HighSuspiciousDesc", { count: hmacSecurityStats.suspiciousActivityCount })}
                            </Text>
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {t("Settings.Security.HMAC.ImmediateActions")}
                            </Text>
                            <List type="bullet">
                              <List.Item><Text as="span" variant="bodySm">{t("Settings.Security.HMAC.ActionRotate")}</Text></List.Item>
                              <List.Item><Text as="span" variant="bodySm">{t("Settings.Security.HMAC.ActionCheckLogs")}</Text></List.Item>
                              <List.Item><Text as="span" variant="bodySm">{t("Settings.Security.HMAC.ActionLeakage")}</Text></List.Item>
                              <List.Item><Text as="span" variant="bodySm">{t("Settings.Security.HMAC.ActionReview")}</Text></List.Item>
                              <List.Item><Text as="span" variant="bodySm">{t("Settings.Security.HMAC.ActionMetrics")}</Text></List.Item>
                            </List>
                          </BlockStack>
                        </Banner>
                      )}
                      {hmacSecurityStats.suspiciousActivityCount > 0 && hmacSecurityStats.suspiciousActivityCount <= 10 && (
                        <Banner tone="warning">
                          <BlockStack gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {t("Settings.Security.HMAC.MediumSuspiciousAlert")}
                            </Text>
                            <Text as="p" variant="bodySm">
                              {t("Settings.Security.HMAC.MediumSuspiciousDesc", { count: hmacSecurityStats.suspiciousActivityCount })}
                            </Text>
                            <Text as="p" variant="bodySm">
                              {t("Settings.Security.HMAC.MediumSuspiciousDesc2")}
                            </Text>
                          </BlockStack>
                        </Banner>
                      )}
                      {hmacSecurityStats.suspiciousActivityCount === 0 && (
                        <Banner tone="success">
                          <Text as="p" variant="bodySm">
                            {t("Settings.Security.HMAC.NoSuspicious")}
                          </Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </BlockStack>
                </Card>
              )}
              {!shop?.hasIngestionSecret && (
                <Banner tone="critical">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <Trans i18nKey="Settings.Security.IngestionKey.NoTokenError" />
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("Settings.Security.IngestionKey.NoTokenDesc")}
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("Settings.Security.IngestionKey.P0SecurityNote")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.IngestionKey.P0SecurityDetails" />
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.IngestionKey.IngestionKeyRisk" />
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.IngestionKey.MustDoActions" />
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <Trans i18nKey="Settings.Security.IngestionKey.RotationMechNote" />
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("Settings.Security.IngestionKey.HowItWorks")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("Settings.Security.IngestionKey.HowItWorksDesc")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.IngestionKey.TokenRotationMech" />
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("Settings.Security.DataRetention.Title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("Settings.Security.DataRetention.Description")}
              </Text>
              <Select
                label={t("Settings.Security.DataRetention.Label")}
                options={[
                  { label: t("Settings.Security.DataRetention.Option30"), value: "30" },
                  { label: t("Settings.Security.DataRetention.Option60"), value: "60" },
                  { label: t("Settings.Security.DataRetention.Option90"), value: "90" },
                  { label: t("Settings.Security.DataRetention.Option180"), value: "180" },
                  { label: t("Settings.Security.DataRetention.Option365"), value: "365" },
                ]}
                value={String(shop?.dataRetentionDays || 90)}
                onChange={handleDataRetentionChange}
                helpText={t("Settings.Security.DataRetention.HelpText")}
              />
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("Settings.Security.DataRetention.InfoTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("Settings.Security.DataRetention.InfoDesc")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.DataRetention.InfoItems" />
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("Settings.Security.DataRetention.InfoNote")}
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="warning">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    {t("Settings.Security.DataRetention.MinimizationTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.DataRetention.MinimizationDesc" />
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.DataRetention.PIINote" />
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("Settings.Security.Privacy.Title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("Settings.Security.Privacy.Description")}
              </Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("Settings.Security.Privacy.LoadingStrategyTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.Privacy.LoadingStrategyDesc" />
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.Privacy.LoadingStrategyItems" />
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <Trans i18nKey="Settings.Security.Privacy.StrategyNote" />
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("Settings.Security.Privacy.BackendFilterTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("Settings.Security.Privacy.BackendFilterDesc")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.Privacy.BackendFilterItems" />
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <Trans i18nKey="Settings.Security.Privacy.DesignReason" />
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="success">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("Settings.Security.Privacy.ActualEffectTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("Settings.Security.Privacy.ActualEffectDesc")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.Privacy.ActualEffectItems" />
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("Settings.Security.Privacy.ComplianceNote")}
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="info">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    {t("Settings.Security.Privacy.StatsTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.Privacy.StatsDesc" />
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("Settings.Security.ConsentStrategy.Title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("Settings.Security.ConsentStrategy.Description")}
              </Text>
              <Select
                label={t("Settings.Security.ConsentStrategy.Label")}
                options={[
                  {
                    label: t("Settings.Security.ConsentStrategy.Strict"),
                    value: "strict",
                  },
                  {
                    label: t("Settings.Security.ConsentStrategy.Balanced"),
                    value: "balanced",
                  },
                ]}
                value={shop?.consentStrategy || "strict"}
                onChange={handleConsentStrategyChange}
                helpText={
                  shop?.consentStrategy === "strict"
                    ? t("Settings.Security.ConsentStrategy.HelpTextStrict")
                    : t("Settings.Security.ConsentStrategy.HelpTextBalanced")
                }
              />
              <Banner
                tone={
                  shop?.consentStrategy === "strict" ? "success" : "info"
                }
              >
                {shop?.consentStrategy === "strict" && (
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      {t("Settings.Security.ConsentStrategy.Strict")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("Settings.Security.ConsentStrategy.StrictNote")}
                    </Text>
                  </BlockStack>
                )}
                {shop?.consentStrategy === "balanced" && (
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      {t("Settings.Security.ConsentStrategy.Balanced")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("Settings.Security.ConsentStrategy.BalancedNote")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("Settings.Security.ConsentStrategy.BalancedAdvice")}
                    </Text>
                  </BlockStack>
                )}
                {shop?.consentStrategy !== "strict" &&
                  shop?.consentStrategy !== "balanced" && (
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">
                        {t("Settings.Security.ConsentStrategy.UnknownStrategy")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {t("Settings.Security.ConsentStrategy.UnknownStrategyDesc")}
                      </Text>
                    </BlockStack>
                  )}
              </Banner>
            </BlockStack>
          </BlockStack>
        </Card>
      </Layout.Section>
      <Modal
        open={showConsentModal}
        onClose={() => {
          setShowConsentModal(false);
          setPendingConsentStrategy(null);
        }}
        title={t("Settings.Security.ConsentStrategy.ModalTitle")}
        primaryAction={{
          content: t("Settings.Security.ConsentStrategy.ConfirmAction"),
          onAction: confirmConsentStrategyChange,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: t("Settings.Security.ConsentStrategy.Cancel"),
            onAction: () => {
              setShowConsentModal(false);
              setPendingConsentStrategy(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              {t("Settings.Security.ConsentStrategy.ModalContent")}
            </Text>
            <Text as="p" tone="subdued">
              {t("Settings.Security.ConsentStrategy.ModalConfirm")}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={showRotateModal}
        onClose={() => setShowRotateModal(false)}
        title={shop?.hasIngestionSecret 
          ? t("Settings.Security.Modals.RotateTitle") 
          : t("Settings.Security.Modals.GenerateTitle")}
        primaryAction={{
          content: shop?.hasIngestionSecret 
            ? t("Settings.Security.Modals.RotateAction") 
            : t("Settings.Security.Modals.GenerateAction"),
          destructive: true,
          onAction: () => {
            setShowRotateModal(false);
            onRotateSecret();
          },
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: t("Settings.Security.ConsentStrategy.Cancel"),
            onAction: () => setShowRotateModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              {shop?.hasIngestionSecret
                ? t("Settings.Security.Modals.RotateDesc")
                : t("Settings.Security.Modals.GenerateDesc")}
            </Text>
            {shop?.hasIngestionSecret && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("Settings.Security.Modals.RiskWarning")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="Settings.Security.Modals.RiskDesc" />
                  </Text>
                </BlockStack>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Layout>
  );
}
