import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams, useActionData } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
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
import { useLocale } from "~/context/LocaleContext";

import { authenticate } from "../shopify.server";
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
  let descriptionKey: string;
  let labelKey: string;
  if (totalHours <= 0.5) {
    labelKey = "onboarding.estimateLabel1";
    descriptionKey = "onboarding.estimateDesc1";
  } else if (totalHours <= 1) {
    labelKey = "onboarding.estimateLabel2";
    descriptionKey = "onboarding.estimateDesc2";
  } else if (totalHours <= 2) {
    labelKey = totalHours <= 1.5 ? "onboarding.estimateLabel3" : "onboarding.estimateLabel4";
    descriptionKey = totalHours <= 1.5 ? "onboarding.estimateDesc3" : "onboarding.estimateDesc4";
  } else {
    labelKey = "onboarding.estimateLabel5";
    descriptionKey = "onboarding.estimateDesc4";
  }
  return {
    hours: Math.round(totalHours * 100) / 100,
    labelKey,
    descriptionKey,
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
    label: string;
    description: string;
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
    migrationEstimate = estimateMigrationTime(
      scriptTags.length,
      platforms.length,
      latestScan.riskScore,
      riskItems
    );
    const shopTier = (shop.shopTier as ShopTier) || "unknown";
    const migrationUrgency = getMigrationUrgencyStatus(shopTier, scriptTags.length > 0, hasOrderStatusScripts);
    urgency = {
      level: migrationUrgency.urgency,
      label: migrationUrgency.urgency === "critical" ? "紧急" :
             migrationUrgency.urgency === "high" ? "高优先级" :
             migrationUrgency.urgency === "medium" ? "中等" : "低",
      description: migrationUrgency.primaryMessage,
    };
  }
  let typOspEnabled = shop.typOspPagesEnabled;
  let typOspReason = shop.typOspStatusReason;
  if (admin && typOspEnabled === null) {
    try {
      const typOspResult = await refreshTypOspStatus(admin, shop.id);
      typOspEnabled = typOspResult.typOspPagesEnabled;
      if (typOspResult.status === "unknown") {
        typOspReason = typOspResult.unknownReason || "检测失败";
      }
    } catch (error) {
      logger.error("Failed to refresh TYP/OSP status", { error });
      typOspEnabled = false;
      typOspReason = "API错误，请稍后重试";
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
    return json({ error: "店铺未找到" }, { status: 404 });
  }
  if (actionType === "run_scan") {
    try {
      const scanResult = await scanShopTracking(admin, shop.id);
      return json({ success: true, actionType: "run_scan", result: scanResult });
    } catch (error) {
      logger.error("Onboarding scan error", { error });
      return json({ error: "扫描失败，请稍后重试" }, { status: 500 });
    }
  }
  if (actionType === "complete_onboarding") {
    const autoSetup = formData.get("auto_setup") !== "false";
    if (autoSetup) {
      try {
        let ingestionSecret: string | undefined = undefined;
        if (shop.ingestionSecret) {
          try {
            if (isTokenEncrypted(shop.ingestionSecret)) {
              ingestionSecret = decryptIngestionSecret(shop.ingestionSecret);
            } else {
              ingestionSecret = shop.ingestionSecret;
              const encryptedSecret = encryptIngestionSecret(ingestionSecret);
              await prisma.shop.update({
                where: { id: shop.id },
                data: { ingestionSecret: encryptedSecret },
              });
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
          }
        }
      } catch (error) {
        logger.error(`[Onboarding] Failed to auto-setup WebPixel for ${shopDomain}`, error);
      }
    }
    return redirect("/app/scan");
  }
  return json({ error: "未知操作" }, { status: 400 });
};

function UrgencyBadge({ level, t }: { level: string; t: (key: string) => string }) {
  const label = level === "critical" ? t("onboarding.urgencyCritical") :
    level === "high" ? t("onboarding.urgencyHigh") :
    level === "medium" ? t("onboarding.urgencyMedium") :
    level === "low" ? t("onboarding.urgencyLow") :
    level === "resolved" ? t("onboarding.urgencyResolved") : t("onboarding.unknown");
  const tone = level === "critical" ? "critical" : level === "high" ? "warning" : level === "medium" ? "attention" : level === "low" ? "info" : level === "resolved" ? "success" : undefined;
  return <Badge tone={tone}>{label}</Badge>;
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
  const { t } = useLocale();
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const { showSuccess, showError } = useToastContext();
  const [acknowledged, setAcknowledged] = useState(false);
  const isScanning = navigation.state === "submitting";
  const autoScan = searchParams.get("autoScan") === "true";
  useEffect(() => {
    if (actionData) {
      if ("success" in actionData && actionData.success) {
        if ("actionType" in actionData && actionData.actionType === "run_scan") {
          showSuccess(t("onboarding.scanComplete"));
        } else if ("actionType" in actionData && actionData.actionType === "complete_onboarding") {
          showSuccess(t("onboarding.welcomeDone"));
        } else {
          showSuccess(t("onboarding.operationSuccess"));
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
  // handleStartScan is defined below; deps intentionally minimal to avoid re-running when isScanning flips
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
  const getPlatformName = (platform: string) => {
    const names: Record<string, string> = {
      google: "Google Analytics 4",
      meta: "Meta (Facebook) Pixel",
      tiktok: "TikTok Pixel",
    };
    return names[platform] || platform;
  };
  if (!data.shop) {
    return (
      <Page title={t("onboarding.welcome")}>
        <Card>
          <Banner tone="critical">
            <Text as="p">{t("onboarding.shopLoadFailed")}</Text>
          </Banner>
        </Card>
      </Page>
    );
  }
  return (
    <Page
      title={t("onboarding.pageTitle")}
      subtitle={t("onboarding.pageSubtitle")}
    >
      <BlockStack gap="500">
        <Card>
          <StepIndicator currentStep={data.step} totalSteps={3} />
          <Divider />
          <Box padding="400">
            <InlineStack gap="400" align="space-between">
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">{t("onboarding.step", { n: 1 })}</Text>
                <Text as="span" fontWeight={data.step >= 1 ? "bold" : "regular"}>
                  {t("onboarding.step1Name")}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">{t("onboarding.step", { n: 2 })}</Text>
                <Text as="span" fontWeight={data.step >= 2 ? "bold" : "regular"}>
                  {t("onboarding.step2Name")}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">{t("onboarding.step", { n: 3 })}</Text>
                <Text as="span" fontWeight={data.step >= 3 ? "bold" : "regular"}>
                  {t("onboarding.step3Name")}
                </Text>
              </BlockStack>
            </InlineStack>
          </Box>
        </Card>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                📋 {t("onboarding.shopOverview")}
              </Text>
              <Badge tone={data.shop.typOspEnabled ? "success" : "warning"}>
                {data.shop.typOspEnabled ? t("onboarding.upgraded") : t("onboarding.legacy")}
              </Badge>
            </InlineStack>
            <Divider />
            <Layout>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("onboarding.domain")}</Text>
                    <Text as="p" fontWeight="semibold">{data.shop.domain}</Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("onboarding.shopType")}</Text>
                    <Text as="p" fontWeight="semibold">
                      {data.shop.tier === "plus" ? t("onboarding.plus") :
                       data.shop.tier === "non_plus" ? t("onboarding.standard") : t("onboarding.pendingCheck")}
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("onboarding.thankYouPage")}</Text>
                    <Text as="p" fontWeight="semibold">
                      {data.shop.typOspEnabled === null ? t("onboarding.pendingCheck") :
                       data.shop.typOspEnabled ? "Extensibility" : t("onboarding.legacy")}
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
            </Layout>
            {data.shop.typOspReason && !data.shop.typOspEnabled && (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  {t("onboarding.detectionNote", { reason: data.shop.typOspReason })}
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
                  🔍 {t("onboarding.autoScan")}
                </Text>
              </InlineStack>
              <Text as="p" tone="subdued">
                {t("onboarding.autoScanDesc")}
              </Text>
              {isScanning ? (
                <Card>
                  <BlockStack gap="400">
                    <CardSkeleton lines={4} showTitle={true} />
                    <Box paddingBlockStart="200">
                      <ProgressBar progress={60} tone="primary" />
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        {t("onboarding.scanningProgress")}
                      </Text>
                    </Box>
                  </BlockStack>
                </Card>
              ) : (
                <BlockStack gap="300">
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">{t("onboarding.scanIncludes")}</Text>
                      <List type="bullet">
                        <List.Item>{t("onboarding.scanItem1")}</List.Item>
                        <List.Item>{t("onboarding.scanItem2")}</List.Item>
                        <List.Item>{t("onboarding.scanItem3")}</List.Item>
                        <List.Item>{t("onboarding.scanItem4")}</List.Item>
                      </List>
                    </BlockStack>
                  </Box>
                  <Checkbox
                    label={t("onboarding.acknowledgeScan")}
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
                      {t("onboarding.startAutoScan")}
                    </Button>
                    <Button url="/app?skip=true" variant="plain">
                      {t("onboarding.skipScan")}
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
                    <Text as="h2" variant="headingMd">{t("onboarding.riskScore")}</Text>
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
                        ? t("onboarding.needActionNow")
                        : data.scanResult.riskScore > 30
                          ? t("onboarding.migrateSoon")
                          : t("onboarding.lowRisk")}
                    </Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">{t("onboarding.estimatedTime")}</Text>
                    <Box background="bg-surface-secondary" padding="600" borderRadius="200">
                      <BlockStack gap="200" align="center">
                        <Icon source={ClockIcon} tone="base" />
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {data.migrationEstimate ? t(data.migrationEstimate.labelKey) : t("onboarding.toEvaluate")}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.migrationEstimate ? t(data.migrationEstimate.descriptionKey) : t("onboarding.estimateDesc")}
                    </Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">{t("onboarding.migrationUrgency")}</Text>
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
                        <UrgencyBadge level={data.urgency?.level || "unknown"} t={t} />
                        <Text as="p" variant="headingMd" fontWeight="bold">
                          {data.urgency?.level === "critical" ? t("onboarding.urgencyCritical") :
                           data.urgency?.level === "high" ? t("onboarding.urgencyHigh") :
                           data.urgency?.level === "medium" ? t("onboarding.urgencyMedium") :
                           data.urgency?.level === "low" ? t("onboarding.urgencyLow") :
                           data.urgency?.level === "resolved" ? t("onboarding.urgencyResolved") : t("onboarding.toEvaluate")}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.urgency?.description || ""}
                    </Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">📊 {t("onboarding.resultSummary")}</Text>
                <Divider />
                <Layout>
                  <Layout.Section variant="oneHalf">
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text as="span">ScriptTags 数量</Text>
                        <Badge tone={data.scanResult.scriptTagCount > 0 ? "warning" : "success"}>
                          {`${data.scanResult.scriptTagCount} 个`}
                        </Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span">订单状态页脚本</Text>
                        <Badge tone={data.scanResult.hasOrderStatusScripts ? "critical" : "success"}>
                          {data.scanResult.hasOrderStatusScripts ? "有" : "无"}
                        </Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span">识别的平台</Text>
                        <Text as="span" fontWeight="semibold">
                          {data.scanResult.platformCount} 个
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </Layout.Section>
                  <Layout.Section variant="oneHalf">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">检测到的追踪平台：</Text>
                      {data.scanResult.platforms.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {data.scanResult.platforms.map((platform) => (
                            <Badge key={platform}>{getPlatformName(platform)}</Badge>
                          ))}
                        </InlineStack>
                      ) : (
                        <Text as="p" tone="subdued">未检测到已知追踪平台</Text>
                      )}
                    </BlockStack>
                  </Layout.Section>
                </Layout>
              </BlockStack>
            </Card>
            {data.scanResult.riskItems.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">⚠️ 风险项</Text>
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
                            {item.severity === "high" ? "高风险" :
                             item.severity === "medium" ? "中风险" : "低风险"}
                          </Badge>
                        </InlineStack>
                      </Box>
                    ))}
                    {data.scanResult.riskItems.length > 5 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        还有 {data.scanResult.riskItems.length - 5} 个风险项，查看完整报告了解详情
                      </Text>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            )}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">🎯 下一步操作</Text>
                <Divider />
                <BlockStack gap="300">
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Icon source={CheckCircleIcon} tone="success" />
                          <Text as="span" fontWeight="semibold">1. 查看完整扫描报告</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          了解每个风险项的详情和迁移建议
                        </Text>
                      </BlockStack>
                      <Button url="/app/scan?tab=2" icon={ArrowRightIcon}>
                        查看报告
                      </Button>
                    </InlineStack>
                  </Box>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">2. 配置追踪平台凭证</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          设置 GA4、Meta、TikTok 等平台的 API 凭证
                        </Text>
                      </BlockStack>
                      <Button url="/app/settings">
                        前往设置
                      </Button>
                    </InlineStack>
                  </Box>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">3. 安装 Web Pixel</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          替换旧的 ScriptTag，启用新的追踪方式
                        </Text>
                      </BlockStack>
                      <Button url="/app/migrate">
                        开始迁移
                      </Button>
                    </InlineStack>
                  </Box>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">4. 验收测试</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          下测试订单，验证追踪是否正常工作
                        </Text>
                      </BlockStack>
                      <Button url="/app/verification">
                        验收向导
                      </Button>
                    </InlineStack>
                  </Box>
                </BlockStack>
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      重要提示：页面侧自定义需要单独迁移
                    </Text>
                    <Text as="p" variant="bodySm">
                      本应用不提供 Thank you / Order status 页面模块库。若您的 Additional Scripts/页面逻辑依赖旧体验，请按 Shopify 官方能力与审核要求进行迁移与验证。
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
                    开始迁移之旅
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </>
        )}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">💡 需要帮助？</Text>
            <Text as="p" tone="subdued">
              如果您在迁移过程中遇到问题，我们提供以下支持：
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="https://shopify.dev/docs/apps/online-store/checkout-extensibility" external>
                Shopify 官方文档
              </Button>
              <Button url="/support">
                联系支持
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
