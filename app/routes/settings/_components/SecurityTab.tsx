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
import { useLocale } from "~/context/LocaleContext";

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
  const { t, locale } = useLocale();
  const dateLocale = locale === "zh" ? "zh-CN" : "en";
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
              {t("settings.securityTitle")}
            </Text>
            <Text as="p" tone="subdued">
              {t("settings.securityDesc")}
            </Text>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("settings.ingestionKeyTitle")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("settings.ingestionKeyDesc")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • {t("settings.ingestionKeyBullet1")}
                <br />• {t("settings.ingestionKeyBullet2")}
                <br />• {t("settings.ingestionKeyBullet3")}
              </Text>
              <Text as="p" variant="bodySm" tone="caution">
                ⚠️ {t("settings.ingestionKeyCaution")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • <strong>TLS</strong>: {t("settings.ingestionKeyTls")}
                <br />• <strong>Origin</strong>: {t("settings.ingestionKeyOrigin")}
                <br />• <strong>HMAC</strong>: {t("settings.ingestionKeyHmac")}
                <br />• <strong>Rate limit</strong>: {t("settings.ingestionKeyRate")}
                <br />• <strong>Data min</strong>: {t("settings.ingestionKeyDataMin")}
              </Text>
              <Text as="p" variant="bodySm" tone="caution">
                {t("settings.securityBoundaryNote")}
                <br />
                {t("settings.integrityKeyNote")}
              </Text>
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      {t("settings.status")}
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      {shop?.hasIngestionSecret ? (
                        <>
                          <Badge tone="success">{t("settings.tokenConfigured")}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {t("settings.tokenConfigured")}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Badge tone="attention">{t("settings.notConfigured")}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {t("settings.reinstallOrGenerate")}
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
                    {shop?.hasIngestionSecret ? t("settings.rotateToken") : t("settings.generateToken")}
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
                    {t("settings.eventValidationMode")}
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={pixelStrictOrigin ? "success" : "warning"}>
                      {pixelStrictOrigin ? t("settings.strict") : t("settings.relaxed")}
                    </Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {pixelStrictOrigin ? t("settings.strictDesc") : t("settings.relaxedDesc")}
                    </Text>
                  </InlineStack>
                  {!pixelStrictOrigin && (
                    <Text as="p" variant="bodySm" tone="caution">
                      {t("settings.relaxedModeCaution")}
                    </Text>
                  )}
                </BlockStack>
              </Box>
              {shop?.hasActiveGraceWindow && shop.graceWindowExpiry && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("settings.oldTokenValid", { date: new Date(shop.graceWindowExpiry).toLocaleString(dateLocale) })}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("settings.graceWindowEnd")}
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              {shop?.hasExpiredPreviousSecret && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("settings.oldTokenExpired")}
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              {hmacSecurityStats && (
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">
                      {t("settings.hmacMonitorTitle")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("settings.hmacMonitorDesc")}
                    </Text>
                    <Divider />
                    <BlockStack gap="300">
                      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {t("settings.keyRotationStatus")}
                            </Text>
                            <Button
                              variant="plain"
                              size="slim"
                              onClick={() => setShowRotateModal(true)}
                              loading={isSubmitting}
                            >
                              {t("settings.rotateNow")}
                            </Button>
                          </InlineStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              {t("settings.lastRotation")}
                            </Text>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {hmacSecurityStats.lastRotationAt 
                                ? new Date(hmacSecurityStats.lastRotationAt).toLocaleString(dateLocale)
                                : t("settings.neverRotated")}
                            </Text>
                          </InlineStack>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              {t("settings.rotationCount")}
                            </Text>
                            <Badge tone={hmacSecurityStats.rotationCount > 0 ? "success" : "info"}>
                              {String(hmacSecurityStats.rotationCount)}
                            </Badge>
                          </InlineStack>
                          {hmacSecurityStats.graceWindowActive && hmacSecurityStats.graceWindowExpiry && (
                            <Banner tone="info">
                              <Text as="p" variant="bodySm">
                                {t("settings.graceWindowActive", { date: new Date(hmacSecurityStats.graceWindowExpiry).toLocaleString(dateLocale) })}
                              </Text>
                            </Banner>
                          )}
                          {!hmacSecurityStats.lastRotationAt && (
                            <Banner tone="warning">
                              <BlockStack gap="200">
                                <Text as="p" variant="bodySm" fontWeight="semibold">
                                  {t("settings.suggestRotate")}
                                </Text>
                                <Text as="p" variant="bodySm">
                                  {t("settings.suggestRotateDesc")}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  💡 {t("settings.rotateTip")}
                                </Text>
                                <Text as="p" variant="bodySm" tone="critical">
                                  ⚠️ {t("settings.rotateWarning")}
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
                                      {t("settings.keyRotated90Days")}
                                    </Text>
                                    <Text as="p" variant="bodySm">
                                      {t("settings.lastRotationDaysAgo", {
                                        date: new Date(hmacSecurityStats.lastRotationAt).toLocaleString(dateLocale),
                                        days: daysSinceRotation,
                                      })}
                                    </Text>
                                    <Text as="p" variant="bodySm" tone="critical">
                                      ⚠️ {t("settings.rotateWarning")}
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
                            {t("settings.suspiciousInjectionAlert")}
                          </Text>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              {t("settings.invalidSignatureCount")}
                            </Text>
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={hmacSecurityStats.invalidSignatureCount > 0 ? "critical" : "success"}>
                                {String(hmacSecurityStats.invalidSignatureCount)}
                              </Badge>
                              {hmacSecurityStats.invalidSignatureCount > 0 && hmacSecurityStats.lastInvalidSignature && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {t("settings.lastOccurrence", { date: new Date(hmacSecurityStats.lastInvalidSignature).toLocaleString(dateLocale) })}
                                </Text>
                              )}
                            </InlineStack>
                          </InlineStack>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              {t("settings.nullOriginRequestCount")}
                            </Text>
                            <Badge tone={hmacSecurityStats.nullOriginRequestCount > 10 ? "warning" : "success"}>
                              {String(hmacSecurityStats.nullOriginRequestCount)}
                            </Badge>
                          </InlineStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {t("settings.totalSuspiciousActivity")}
                            </Text>
                            <Badge tone={hmacSecurityStats.suspiciousActivityCount > 10 ? "critical" : hmacSecurityStats.suspiciousActivityCount > 0 ? "warning" : "success"}>
                              {String(hmacSecurityStats.suspiciousActivityCount)}
                            </Badge>
                          </InlineStack>
                          {hmacSecurityStats.suspiciousActivityCount > 0 && hmacSecurityStats.lastSuspiciousActivity && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("settings.lastSuspiciousActivityAt", { date: new Date(hmacSecurityStats.lastSuspiciousActivity).toLocaleString(dateLocale) })}
                            </Text>
                          )}
                        </BlockStack>
                      </Box>
                      {hmacSecurityStats.suspiciousActivityCount > 10 && (
                        <Banner tone="critical">
                          <BlockStack gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {t("settings.highSuspiciousBannerTitle")}
                            </Text>
                            <Text as="p" variant="bodySm">
                              {t("settings.highSuspiciousBannerDesc", { count: hmacSecurityStats.suspiciousActivityCount })}
                            </Text>
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {t("settings.highSuspiciousBannerActions")}
                            </Text>
                            <List type="bullet">
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  {t("settings.highSuspiciousItem1")}
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  {t("settings.highSuspiciousItem2")}
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  {t("settings.highSuspiciousItem3")}
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  {t("settings.highSuspiciousItem4")}
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  {t("settings.highSuspiciousItem5")}
                                </Text>
                              </List.Item>
                            </List>
                          </BlockStack>
                        </Banner>
                      )}
                      {hmacSecurityStats.suspiciousActivityCount > 0 && hmacSecurityStats.suspiciousActivityCount <= 10 && (
                        <Banner tone="warning">
                          <BlockStack gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {t("settings.mediumSuspiciousBannerTitle")}
                            </Text>
                            <Text as="p" variant="bodySm">
                              {t("settings.mediumSuspiciousBannerDesc", { count: hmacSecurityStats.suspiciousActivityCount })}
                            </Text>
                            <Text as="p" variant="bodySm">
                              {t("settings.mediumSuspiciousBannerTip")}
                            </Text>
                          </BlockStack>
                        </Banner>
                      )}
                      {hmacSecurityStats.suspiciousActivityCount === 0 && (
                        <Banner tone="success">
                          <Text as="p" variant="bodySm">
                            {t("settings.noSuspiciousBanner")}
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
                      {t("settings.noTokenBannerTitle")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("settings.noTokenBannerDesc")}
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("settings.p0SecurityBannerTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>{t("settings.p0SecurityBannerP1")}</strong>
                    <br />• <code>PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY</code>: {t("settings.p0SecurityEnvVar")}
                    <br />• {t("settings.p0SecuritySandbox")}
                    <br />• {t("settings.p0SecurityFalse")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>{t("settings.p0SecurityVisibility")}</strong>
                    <br />• {t("settings.p0SecurityVisibilityBullet1")}
                    <br />• {t("settings.p0SecurityVisibilityBullet2")}
                    <br />• {t("settings.p0SecurityVisibilityBullet3")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>{t("settings.p0SecurityMeasures")}</strong>
                    <br />• {t("settings.p0SecurityMeasure1")}
                    <br />• {t("settings.p0SecurityMeasure2")}
                    <br />• {t("settings.p0SecurityMeasure3")}
                    <br />• {t("settings.p0SecurityMeasure4")}
                    <br />• {t("settings.p0SecurityMeasure5")}
                    <br />• {t("settings.p0SecurityMeasure6")}
                    <br />• {t("settings.p0SecurityMeasure7")}
                    <br />• {t("settings.p0SecurityMeasure8")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("settings.p0SecurityRotationNote")}
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("settings.howItWorksTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("settings.howItWorksP1")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>{t("settings.howItWorksRotation")}</strong>
                    <br />• {t("settings.howItWorksBullet1")}
                    <br />• {t("settings.howItWorksBullet2")}
                    <br />• {t("settings.howItWorksBullet3")}
                    <br />• {t("settings.howItWorksBullet4")}
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("settings.dataRetentionTitle")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("settings.dataRetentionDesc")}
              </Text>
              <Select
                label={t("settings.dataRetentionDaysLabel")}
                options={[
                  { label: t("settings.dataRetentionOption30"), value: "30" },
                  { label: t("settings.dataRetentionOption60"), value: "60" },
                  { label: t("settings.dataRetentionOption90"), value: "90" },
                  { label: t("settings.dataRetentionOption180"), value: "180" },
                  { label: t("settings.dataRetentionOption365"), value: "365" },
                ]}
                value={String(shop?.dataRetentionDays || 90)}
                onChange={handleDataRetentionChange}
                helpText={t("settings.dataRetentionHelpText")}
              />
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("settings.dataRetentionNoteTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("settings.dataRetentionNoteP1")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    • <strong>{t("settings.dataRetentionConversionLog")}</strong>
                    <br />• <strong>{t("settings.dataRetentionPixelReceipt")}</strong>
                    <br />• <strong>{t("settings.dataRetentionScanReport")}</strong>
                    <br />• <strong>{t("settings.dataRetentionReconciliation")}</strong>
                    <br />• <strong>{t("settings.dataRetentionDeadLetter")}</strong>
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("settings.dataRetentionCleanup")}
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="warning">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    {t("settings.dataMinimizationTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("settings.dataMinimizationP1")}
                    <br />• {t("settings.dataMinimizationBullets")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("settings.dataMinimizationPii")}
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("settings.pixelPrivacyTitle")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("settings.pixelPrivacyDesc")}
              </Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("settings.pixelLoadPolicyTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("settings.pixelLoadPolicyP1")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    • {t("settings.pixelLoadPolicyBullets")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("settings.pixelLoadPolicyNote")}
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("settings.backendFilterTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("settings.backendFilterP1")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    • {t("settings.backendFilterBullets")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("settings.backendFilterWhy")}
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="success">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("settings.actualEffectTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("settings.actualEffectP1")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    • {t("settings.actualEffectBullets")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("settings.actualEffectNote")}
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="info">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    {t("settings.viewFilterStatsTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("settings.viewFilterStatsP1")}
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("settings.consentStrategyTitle")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("settings.consentStrategyDesc")}
              </Text>
              <Select
                label={t("settings.strategySelectLabel")}
                options={[
                  { label: t("settings.consentOptionStrict"), value: "strict" },
                  { label: t("settings.consentOptionBalanced"), value: "balanced" },
                ]}
                value={shop?.consentStrategy || "strict"}
                onChange={handleConsentStrategyChange}
                helpText={
                  shop?.consentStrategy === "strict"
                    ? t("settings.consentHelpStrict")
                    : t("settings.consentHelpBalanced")
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
                      {t("settings.strictModeLabel")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("settings.strictModeDesc")}
                    </Text>
                  </BlockStack>
                )}
                {shop?.consentStrategy === "balanced" && (
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      {t("settings.balancedModeLabel")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("settings.balancedModeDesc")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("settings.balancedModeSuggestion")}
                    </Text>
                  </BlockStack>
                )}
                {shop?.consentStrategy !== "strict" &&
                  shop?.consentStrategy !== "balanced" && (
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">
                        {t("settings.unknownStrategyLabel")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {t("settings.unknownStrategyDesc")}
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
        title={t("settings.confirmSwitchConsent")}
        primaryAction={{
          content: t("settings.confirmSwitch"),
          onAction: confirmConsentStrategyChange,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: t("settings.cancel"),
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
              {t("settings.consentModalBody1")}
            </Text>
            <Text as="p" tone="subdued">
              {t("settings.consentModalBody2")}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={showRotateModal}
        onClose={() => setShowRotateModal(false)}
        title={shop?.hasIngestionSecret ? t("settings.confirmRotateToken") : t("settings.confirmGenerateToken")}
        primaryAction={{
          content: shop?.hasIngestionSecret ? t("settings.confirmRotate") : t("settings.confirmGenerate"),
          destructive: true,
          onAction: () => {
            setShowRotateModal(false);
            onRotateSecret();
          },
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: t("settings.cancel"),
            onAction: () => setShowRotateModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              {shop?.hasIngestionSecret
                ? t("settings.rotateModalBody")
                : t("settings.generateModalBody")}
            </Text>
            {shop?.hasIngestionSecret && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("settings.rotateRiskTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("settings.rotateRiskP1")}
                    <br />• {t("settings.rotateRiskBullet1")}
                    <br />• {t("settings.rotateRiskBullet2")}
                    <br />• {t("settings.rotateRiskBullet3")}
                    <br />• {t("settings.rotateRiskBullet4")}
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
