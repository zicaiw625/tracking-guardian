import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams, useActionData } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  ProgressBar,
  Icon,
  List,
  Checkbox,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ArrowRightIcon,
  ClockIcon,
} from "~/components/icons";
import { CardSkeleton, useToastContext } from "~/components/ui";
import { getPlatformName } from "~/components/scan/utils";

import { authenticate } from "../shopify.server";
import { i18nServer } from "../i18n.server";
import prisma from "../db.server";
import { scanShopTracking } from "../services/scanner.server";
import { refreshTypOspStatus } from "../services/checkout-profile.server";
import { getMigrationUrgencyStatus, type ShopTier } from "../utils/deprecation-dates";
import type { ScriptTag, RiskItem } from "../types";
import { logger } from "../utils/logger.server";
import { trackEvent } from "../services/analytics.server";
import { safeFireAndForget } from "../utils/helpers.server";
import { normalizePlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";
import { createWebPixel, getExistingWebPixels, isOurWebPixel, updateWebPixel } from "../services/migration.server";
import { decryptIngestionSecret, encryptIngestionSecret, isTokenEncrypted } from "../utils/token-encryption.server";
import { randomBytes } from "crypto";

function estimateMigrationTime(
  scriptTagCount: number,
  platformCount: number,
  riskScore: number,
  riskItems?: RiskItem[]
): { hours: number; labelKey: string; descriptionKey: string } {
  const baseTime = 0.25;
  const highRiskScriptTags = riskItems?.filter(item => item.severity === "high").length || 0;
  const mediumRiskScriptTags = riskItems?.filter(item => item.severity === "medium").length || 0;
  const lowRiskScriptTags = (scriptTagCount - highRiskScriptTags - mediumRiskScriptTags) || 0;
  const perHighRiskScriptTag = 0.4;
  const perMediumRiskScriptTag = 0.25;
  const perLowRiskScriptTag = 0.15;
  const scriptTagTime =
    highRiskScriptTags * perHighRiskScriptTag +
    mediumRiskScriptTags * perMediumRiskScriptTag +
    lowRiskScriptTags * perLowRiskScriptTag;
  const perSimplePlatform = 0.3;
  const platformTime = platformCount * perSimplePlatform;
  let riskMultiplier = 1.0;
  if (riskScore > 70) {
    riskMultiplier = 1.6;
  } else if (riskScore > 50) {
    riskMultiplier = 1.4;
  } else if (riskScore > 30) {
    riskMultiplier = 1.2;
  } else if (riskScore > 10) {
    riskMultiplier = 1.1;
  }
  const parallelFactor = platformCount > 1 ? 0.7 : 1.0;
  const sequentialTime = baseTime + scriptTagTime + platformTime;
  const parallelTime = baseTime + scriptTagTime + (platformTime * parallelFactor);
  const totalHours = Math.max(sequentialTime, parallelTime) * riskMultiplier;
  let descriptionKey = "";
  if (totalHours <= 0.5) {
    descriptionKey = "onboarding.estimate.descFast";
  } else if (totalHours <= 1) {
    descriptionKey = "onboarding.estimate.descStandard";
  } else if (totalHours <= 2) {
    descriptionKey = "onboarding.estimate.descMedium";
  } else {
    descriptionKey = "onboarding.estimate.descComplex";
  }
  let labelKey = "";
  if (totalHours <= 0.5) {
    labelKey = "onboarding.estimate.min30";
  } else if (totalHours <= 1) {
    labelKey = "onboarding.estimate.hour1";
  } else if (totalHours <= 1.5) {
    labelKey = "onboarding.estimate.hour1_5";
  } else if (totalHours <= 2) {
    labelKey = "onboarding.estimate.hour2";
  } else {
    labelKey = "onboarding.estimate.hour2plus";
  }
  return {
    hours: Math.round(totalHours * 100) / 100,
    labelKey,
    descriptionKey
  };
}

interface OnboardingData {
  step: number;
  isScanning: boolean;
  scanComplete: boolean;
  shop: {
    id: string;
    domain: string;
    tier: ShopTier;
    typOspEnabled: boolean | null;
    typOspReason: string | null;
  } | null;
  scanResult: {
    riskScore: number;
    scriptTagCount: number;
    platformCount: number;
    platforms: string[];
    hasOrderStatusScripts: boolean;
    riskItems: RiskItem[];
  } | null;
  migrationEstimate: {
    hours: number;
    labelKey: string;
    descriptionKey: string;
  } | null;
  urgency: {
    level: "critical" | "high" | "medium" | "low" | "resolved";
    labelKey: string;
    descriptionKey: string;
    descriptionParams?: Record<string, any>;
  } | null;
  onboardingComplete: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);
  const autoScan = url.searchParams.get("autoScan") === "true";
  const skipOnboarding = url.searchParams.get("skip") === "true";
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      shopTier: true,
      plan: true,
      typOspPagesEnabled: true,
      typOspStatusReason: true,
      ScanReports: {
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!shop) {
    return json<OnboardingData>({
      step: 1,
      isScanning: false,
      scanComplete: false,
      shop: null,
      scanResult: null,
      migrationEstimate: null,
      urgency: null,
      onboardingComplete: false,
    });
  }
  if (skipOnboarding) {
    return redirect("/app");
  }
    const planId = normalizePlanId(shop.plan ?? "free");
  const isAgency = isPlanAtLeast(planId, "agency");
    safeFireAndForget(
    trackEvent({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      event: "app_onboarding_started",
      eventId: `app_onboarding_started_${shop.id}`,
      metadata: {
        plan: shop.plan ?? "free",
        role: isAgency ? "agency" : "merchant",
              },
    })
  );
  const latestScan = shop.ScanReports?.[0];
  if (!latestScan && admin && !autoScan) {
    scanShopTracking(admin, shop.id).catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      logger.error("Auto-scan failed in onboarding", err instanceof Error ? err : new Error(String(err)), {
        shopId: shop.id,
        errorMessage,
        errorStack,
      });
    });
  }
  let scanResult: OnboardingData["scanResult"] = null;
  let migrationEstimate: OnboardingData["migrationEstimate"] = null;
  let urgency: OnboardingData["urgency"] = null;
  if (latestScan) {
    const scriptTags = (latestScan.scriptTags as ScriptTag[] | null) || [];
    const platforms = (latestScan.identifiedPlatforms as string[] | null) || [];
    const riskItems = (latestScan.riskItems as RiskItem[] | null) || [];
    const hasOrderStatusScripts = scriptTags.some(tag => tag.display_scope === "order_status");
    scanResult = {
      riskScore: latestScan.riskScore,
      scriptTagCount: scriptTags.length,
      platformCount: platforms.length,
      platforms,
      hasOrderStatusScripts,
      riskItems,
    };
    const { hours, labelKey, descriptionKey } = estimateMigrationTime(
      scriptTags.length,
      platforms.length,
      latestScan.riskScore,
      riskItems
    );
    migrationEstimate = {
      hours,
      labelKey,
      descriptionKey,
    };
    const shopTier = (shop.shopTier as ShopTier) || "unknown";
    const migrationUrgency = getMigrationUrgencyStatus(shopTier, scriptTags.length > 0, hasOrderStatusScripts);
    urgency = {
      level: migrationUrgency.urgency,
      labelKey: `onboarding.urgency.${migrationUrgency.urgency}`,
      descriptionKey: migrationUrgency.primaryMessageKey,
      descriptionParams: migrationUrgency.primaryMessageParams,
    };
  }
  let typOspEnabled = shop.typOspPagesEnabled;
  let typOspReason = shop.typOspStatusReason;
  if (admin && typOspEnabled === null) {
    try {
      const typOspResult = await refreshTypOspStatus(admin, shop.id);
      typOspEnabled = typOspResult.typOspPagesEnabled;
      if (typOspResult.status === "unknown") {
        typOspReason = typOspResult.unknownReason || "onboarding.errors.detectFailed";
      }
    } catch (error) {
      logger.error("Failed to refresh TYP/OSP status", { error });
      typOspEnabled = false;
      typOspReason = "onboarding.errors.apiError";
    }
  }
  const data: OnboardingData = {
    step: latestScan ? 3 : 1,
    isScanning: false,
    scanComplete: !!latestScan,
    shop: {
      id: shop.id,
      domain: shop.shopDomain,
      tier: (shop.shopTier as ShopTier) || "unknown",
      typOspEnabled,
      typOspReason,
    },
    scanResult,
    migrationEstimate,
    urgency,
    onboardingComplete: !!latestScan,
  };
  return json(data);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });
  if (!shop) {
    return json({ error: "onboarding.errors.shopNotFound" }, { status: 404 });
  }
  const t = await i18nServer.getFixedT(request);
  if (actionType === "run_scan") {
    try {
      const scanResult = await scanShopTracking(admin, shop.id);
      return json({ success: true, actionType: "run_scan", result: scanResult });
    } catch (error) {
      logger.error("Onboarding scan error", { error });
      return json({ error: "onboarding.errors.scanFailed" }, { status: 500 });
    }
  }
  if (actionType === "complete_onboarding") {
    const autoSetup = formData.get("auto_setup") !== "false";
    let webPixelSetupFailed = false;
    if (autoSetup) {
      try {
        let ingestionSecret: string | undefined = undefined;
        if (shop.ingestionSecret) {
          try {
            if (isTokenEncrypted(shop.ingestionSecret)) {
              ingestionSecret = decryptIngestionSecret(shop.ingestionSecret);
            } else {
              const secretToEncrypt = shop.ingestionSecret as string;
              const encryptedSecret = encryptIngestionSecret(secretToEncrypt);
              safeFireAndForget(
                prisma.shop.update({
                  where: { id: shop.id },
                  data: { ingestionSecret: encryptedSecret },
                })
              );
              ingestionSecret = secretToEncrypt;
            }
          } catch (error) {
            logger.error(`[Onboarding] Failed to decrypt ingestionSecret for ${shopDomain}`, error);
          }
        }
        if (!ingestionSecret) {
          ingestionSecret = randomBytes(32).toString("hex");
          const encryptedSecret = encryptIngestionSecret(ingestionSecret);
          await prisma.shop.update({
            where: { id: shop.id },
            data: { ingestionSecret: encryptedSecret },
          });
        }
        let ourPixelId = shop.webPixelId;
        if (!ourPixelId) {
          const existingPixels = await getExistingWebPixels(admin);
          const ourPixel = existingPixels.find((p) => {
            if (!p.settings) return false;
            try {
              const settings = JSON.parse(p.settings);
              return isOurWebPixel(settings, shopDomain);
            } catch {
              return false;
            }
          });
          ourPixelId = ourPixel?.id ?? null;
        }
        if (ourPixelId) {
          const result = await updateWebPixel(admin, ourPixelId, ingestionSecret, shopDomain);
          if (!result.success) {
            logger.warn(`[Onboarding] Failed to update WebPixel for ${shopDomain}: ${result.error}`);
            webPixelSetupFailed = true;
          }
        } else {
          const result = await createWebPixel(admin, ingestionSecret, shopDomain);
          if (result.success && result.webPixelId) {
            await prisma.shop.update({
              where: { id: shop.id },
              data: { webPixelId: result.webPixelId },
            });
          } else {
            logger.warn(`[Onboarding] Failed to create WebPixel for ${shopDomain}: ${result.error}`);
            webPixelSetupFailed = true;
          }
        }
      } catch (error) {
        logger.error(`[Onboarding] Failed to auto-setup WebPixel for ${shopDomain}`, error);
        webPixelSetupFailed = true;
      }
    }
    if (webPixelSetupFailed) {
      return json({ success: false, error: t("onboarding.errors.apiError") }, { status: 500 });
    }
    return redirect("/app/scan");
  }
  return json({ error: t("onboarding.action.unknownAction") }, { status: 400 });
};

function UrgencyBadge({ level }: { level: string }) {
  const { t } = useTranslation();
  switch (level) {
    case "critical":
      return <Badge tone="critical">{t("onboarding.urgency.critical")}</Badge>;
    case "high":
      return <Badge tone="warning">{t("onboarding.urgency.high")}</Badge>;
    case "medium":
      return <Badge tone="attention">{t("onboarding.urgency.medium")}</Badge>;
    case "low":
      return <Badge tone="info">{t("onboarding.urgency.low")}</Badge>;
    case "resolved":
      return <Badge tone="success">{t("onboarding.urgency.resolved")}</Badge>;
    default:
      return <Badge>{t("onboarding.urgency.unknown")}</Badge>;
  }
}

function StepIndicator({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <Box padding="400">
      <InlineStack gap="200" align="center">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
          <InlineStack key={step} gap="100" blockAlign="center">
            <Box
              background={step <= currentStep ? "bg-fill-success" : "bg-surface-secondary"}
              borderRadius="full"
              padding="200"
              minWidth="32px"
            >
              <Text
                as="span"
                variant="bodySm"
                fontWeight="bold"
                alignment="center"
              >
                {step < currentStep ? "✓" : step}
              </Text>
            </Box>
            {step < totalSteps && (
              <Box
                background={step < currentStep ? "bg-fill-success" : "bg-surface-secondary"}
                minWidth="40px"
                minHeight="2px"
              />
            )}
          </InlineStack>
        ))}
      </InlineStack>
    </Box>
  );
}

export default function OnboardingPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const { showSuccess, showError } = useToastContext();
  const [acknowledged, setAcknowledged] = useState(false);
  const isScanning = navigation.state === "submitting";
  const autoScan = searchParams.get("autoScan") === "true";
  const { t } = useTranslation();

  useEffect(() => {
    if (actionData) {
      if ("success" in actionData && actionData.success) {
        if ("actionType" in actionData && actionData.actionType === "run_scan") {
          showSuccess(t("onboarding.success.scanComplete"));
        } else if ("actionType" in actionData && actionData.actionType === "complete_onboarding") {
          showSuccess(t("onboarding.success.welcome"));
        } else {
          showSuccess(t("onboarding.success.operation"));
        }
      } else if ("error" in actionData && actionData.error) {
        showError(actionData.error);
      }
    }
  }, [actionData, showSuccess, showError, t]);

  useEffect(() => {
    if (autoScan && !data.scanComplete && !isScanning) {
      handleStartScan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan]);

  const handleStartScan = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "run_scan");
    submit(formData, { method: "post" });
  }, [submit]);

  const handleCompleteOnboarding = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "complete_onboarding");
    submit(formData, { method: "post" });
  }, [submit]);

  if (!data.shop) {
    return (
      <Page title={t("onboarding.welcome.errorTitle")}>
        <Card>
          <Banner tone="critical">
            <Text as="p">{t("onboarding.welcome.errorShopNotFound")}</Text>
          </Banner>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title={t("onboarding.welcome.title")}
      subtitle={t("onboarding.welcome.subtitle")}
    >
      <BlockStack gap="500">
        <Card>
          <StepIndicator currentStep={data.step} totalSteps={3} />
          <Divider />
          <Box padding="400">
            <InlineStack gap="400" align="space-between">
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">{t("onboarding.steps.step1")}</Text>
                <Text as="span" fontWeight={data.step >= 1 ? "bold" : "regular"}>
                  {t("onboarding.steps.step1")}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">{t("onboarding.steps.step2")}</Text>
                <Text as="span" fontWeight={data.step >= 2 ? "bold" : "regular"}>
                  {t("onboarding.steps.step2")}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">{t("onboarding.steps.step3")}</Text>
                <Text as="span" fontWeight={data.step >= 3 ? "bold" : "regular"}>
                  {t("onboarding.steps.step3")}
                </Text>
              </BlockStack>
            </InlineStack>
          </Box>
        </Card>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {t("onboarding.shopStatus.title")}
              </Text>
              <Badge tone={data.shop.typOspEnabled ? "success" : "warning"}>
                {data.shop.typOspEnabled ? t("onboarding.shopStatus.upgraded") : t("onboarding.shopStatus.legacy")}
              </Badge>
            </InlineStack>
            <Divider />
            <Layout>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("onboarding.shopStatus.domain")}</Text>
                    <Text as="p" fontWeight="semibold">{data.shop.domain}</Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("onboarding.shopStatus.tier")}</Text>
                    <Text as="p" fontWeight="semibold">
                      {data.shop.tier === "plus" ? t("onboarding.shopStatus.tierPlus") :
                       data.shop.tier === "non_plus" ? t("onboarding.shopStatus.tierStandard") : t("onboarding.shopStatus.tierUnknown")}
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("onboarding.shopStatus.thankYouPage")}</Text>
                    <Text as="p" fontWeight="semibold">
                      {data.shop.typOspEnabled === null ? t("onboarding.shopStatus.thankYouUnknown") :
                       data.shop.typOspEnabled ? t("onboarding.shopStatus.thankYouNew") : t("onboarding.shopStatus.thankYouOld")}
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
            </Layout>
            {data.shop.typOspReason && !data.shop.typOspEnabled && (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  {t("onboarding.shopStatus.detectReason")} {data.shop.typOspReason}
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>
        {!data.scanComplete && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {t("onboarding.autoScan.title")}
                </Text>
              </InlineStack>
              <Text as="p" tone="subdued">
                {t("onboarding.autoScan.description")}
              </Text>
              {isScanning ? (
                <Card>
                  <BlockStack gap="400">
                    <CardSkeleton lines={4} showTitle={true} />
                    <Box paddingBlockStart="200">
                      <ProgressBar progress={60} tone="primary" />
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        {t("onboarding.autoScan.scanning")}
                      </Text>
                    </Box>
                  </BlockStack>
                </Card>
              ) : (
                <BlockStack gap="300">
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">{t("onboarding.autoScan.includes")}</Text>
                      <List type="bullet">
                        <List.Item>{t("onboarding.autoScan.itemScriptTags")}</List.Item>
                        <List.Item>{t("onboarding.autoScan.itemWebPixels")}</List.Item>
                        <List.Item>{t("onboarding.autoScan.itemCheckout")}</List.Item>
                        <List.Item>{t("onboarding.autoScan.itemPlatforms")}</List.Item>
                      </List>
                    </BlockStack>
                  </Box>
                  <Checkbox
                    label={t("onboarding.autoScan.acknowledge")}
                    checked={acknowledged}
                    onChange={setAcknowledged}
                  />
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      onClick={handleStartScan}
                      disabled={!acknowledged}
                      loading={isScanning}
                      size="large"
                    >
                      {t("onboarding.autoScan.start")}
                    </Button>
                    <Button url="/app?skip=true" variant="plain">
                      {t("onboarding.autoScan.skip")}
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}
        {data.scanComplete && data.scanResult && (
          <>
            <Layout>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">{t("onboarding.riskScore.title")}</Text>
                    <Box
                      background={
                        data.scanResult.riskScore > 60
                          ? "bg-fill-critical"
                          : data.scanResult.riskScore > 30
                            ? "bg-fill-warning"
                            : "bg-fill-success"
                      }
                      padding="600"
                      borderRadius="200"
                    >
                      <BlockStack gap="200" align="center">
                        <Text as="p" variant="heading3xl" fontWeight="bold">
                          {data.scanResult.riskScore}
                        </Text>
                        <Text as="p" variant="bodySm">/100</Text>
                      </BlockStack>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.scanResult.riskScore > 60
                        ? t("onboarding.riskScore.high")
                        : data.scanResult.riskScore > 30
                          ? t("onboarding.riskScore.medium")
                          : t("onboarding.riskScore.low")}
                    </Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">{t("onboarding.estimate.title")}</Text>
                    <Box background="bg-surface-secondary" padding="600" borderRadius="200">
                      <BlockStack gap="200" align="center">
                        <Icon source={ClockIcon} tone="base" />
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {data.migrationEstimate?.labelKey ? t(data.migrationEstimate.labelKey) : t("onboarding.estimate.pending")}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.migrationEstimate?.descriptionKey ? t(data.migrationEstimate.descriptionKey) : t("onboarding.estimate.pendingDesc")}
                    </Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">{t("onboarding.urgency.title")}</Text>
                    <Box
                      background={
                        data.urgency?.level === "critical"
                          ? "bg-fill-critical-secondary"
                          : data.urgency?.level === "high"
                            ? "bg-fill-warning-secondary"
                            : "bg-surface-secondary"
                      }
                      padding="600"
                      borderRadius="200"
                    >
                      <BlockStack gap="200" align="center">
                        <UrgencyBadge level={data.urgency?.level || "unknown"} />
                        <Text as="p" variant="headingMd" fontWeight="bold">
                          {data.urgency?.labelKey ? t(data.urgency.labelKey) : t("onboarding.urgency.pending")}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.urgency?.descriptionKey ? t(data.urgency.descriptionKey, data.urgency.descriptionParams) : ""}
                    </Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{t("onboarding.summary.title")}</Text>
                <Divider />
                <Layout>
                  <Layout.Section variant="oneHalf">
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text as="span">{t("onboarding.summary.scriptTags")}</Text>
                        <Badge tone={data.scanResult.scriptTagCount > 0 ? "warning" : "success"}>
                          {`${data.scanResult.scriptTagCount}`}
                        </Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span">{t("onboarding.summary.orderStatus")}</Text>
                        <Badge tone={data.scanResult.hasOrderStatusScripts ? "critical" : "success"}>
                          {data.scanResult.hasOrderStatusScripts ? t("onboarding.summary.has") : t("onboarding.summary.none")}
                        </Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span">{t("onboarding.summary.platforms")}</Text>
                        <Text as="span" fontWeight="semibold">
                          {data.scanResult.platformCount}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </Layout.Section>
                  <Layout.Section variant="oneHalf">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">{t("onboarding.summary.detected")}</Text>
                      {data.scanResult.platforms.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {data.scanResult.platforms.map((platform) => (
                            <Badge key={platform}>{getPlatformName(platform, t)}</Badge>
                          ))}
                        </InlineStack>
                      ) : (
                        <Text as="p" tone="subdued">{t("onboarding.summary.noDetected")}</Text>
                      )}
                    </BlockStack>
                  </Layout.Section>
                </Layout>
              </BlockStack>
            </Card>
            {data.scanResult.riskItems.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">{t("onboarding.risks.title")}</Text>
                  <Divider />
                  <BlockStack gap="300">
                    {data.scanResult.riskItems.slice(0, 5).map((item, index) => (
                      <Box
                        key={index}
                        background="bg-surface-secondary"
                        padding="400"
                        borderRadius="200"
                      >
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="100">
                            <InlineStack gap="200">
                              <Icon
                                source={AlertCircleIcon}
                                tone={
                                  item.severity === "high"
                                    ? "critical"
                                    : item.severity === "medium"
                                      ? "warning"
                                      : "info"
                                }
                              />
                              <Text as="span" fontWeight="semibold">{item.name}</Text>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {item.description}
                            </Text>
                          </BlockStack>
                          <Badge
                            tone={
                              item.severity === "high"
                                ? "critical"
                                : item.severity === "medium"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {item.severity === "high" ? t("onboarding.riskScore.high") :
                             item.severity === "medium" ? t("onboarding.riskScore.medium") : t("onboarding.riskScore.low")}
                          </Badge>
                        </InlineStack>
                      </Box>
                    ))}
                    {data.scanResult.riskItems.length > 5 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("onboarding.risks.more", { count: data.scanResult.riskItems.length - 5 })}
                      </Text>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            )}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{t("onboarding.nextSteps.title")}</Text>
                <Divider />
                <BlockStack gap="300">
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Icon source={CheckCircleIcon} tone="success" />
                          <Text as="span" fontWeight="semibold">{t("onboarding.nextSteps.step1")}</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("onboarding.nextSteps.step1Desc")}
                        </Text>
                      </BlockStack>
                      <Button url="/app/scan?tab=2" icon={ArrowRightIcon}>
                        {t("onboarding.nextSteps.actionReport")}
                      </Button>
                    </InlineStack>
                  </Box>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">{t("onboarding.nextSteps.step2")}</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("onboarding.nextSteps.step2Desc")}
                        </Text>
                      </BlockStack>
                      <Button url="/app/settings">
                        {t("onboarding.nextSteps.actionSettings")}
                      </Button>
                    </InlineStack>
                  </Box>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">{t("onboarding.nextSteps.step3")}</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("onboarding.nextSteps.step3Desc")}
                        </Text>
                      </BlockStack>
                      <Button url="/app/migrate">
                        {t("onboarding.nextSteps.actionMigrate")}
                      </Button>
                    </InlineStack>
                  </Box>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">{t("onboarding.nextSteps.step4")}</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("onboarding.nextSteps.step4Desc")}
                        </Text>
                      </BlockStack>
                      <Button url="/app/verification">
                        {t("onboarding.nextSteps.actionVerify")}
                      </Button>
                    </InlineStack>
                  </Box>
                </BlockStack>
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("onboarding.nextSteps.important")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("onboarding.nextSteps.importantDesc")}
                    </Text>
                  </BlockStack>
                </Banner>
                <Divider />
                <InlineStack align="end">
                  <Button
                    variant="primary"
                    onClick={handleCompleteOnboarding}
                    size="large"
                    icon={ArrowRightIcon}
                  >
                    {t("onboarding.nextSteps.startJourney")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </>
        )}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("onboarding.help.title")}</Text>
            <Text as="p" tone="subdued">
              {t("onboarding.help.desc")}
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="https://shopify.dev/docs/apps/online-store/checkout-extensibility" external>
                {t("onboarding.help.docs")}
              </Button>
              <Button url="/support">
                {t("onboarding.help.contact")}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
