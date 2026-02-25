import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Divider,
  Link,
  List,
} from "@shopify/polaris";
import { EnhancedEmptyState, useToastContext } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { validateTestEnvironment } from "~/services/migration-wizard.server";
import { normalizePlanId, planSupportsFeature, type PlanId } from "~/services/billing/plans";
import { getPixelEventIngestionUrl } from "~/utils/config.server";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";
import { useTranslation, Trans } from "react-i18next";
import { i18nServer } from "~/i18n.server";


const PLATFORM_LABELS: Record<string, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const pixelConfigId = params.id;
  if (!pixelConfigId) {
    throw new Response("Missing pixel config id", { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true, plan: true },
  });
  if (!shop) {
    return json({ shop: null, pixelConfig: null, hasVerificationAccess: false, backendUrlInfo: { url: "", usage: "none" } });
  }
  const pixelConfig = await prisma.pixelConfig.findFirst({
    where: { id: pixelConfigId, shopId: shop.id },
    select: {
      id: true,
      platform: true,
      environment: true,
      configVersion: true,
      platformId: true,
    },
  });
  if (!pixelConfig) {
    throw new Response("Pixel config not found", { status: 404 });
  }
  const planId = normalizePlanId(shop.plan ?? "free");
  const hasVerificationAccess = planSupportsFeature(planId, "verification");
    if (!hasVerificationAccess) {
    const { trackEvent } = await import("~/services/analytics.server");
    const { safeFireAndForget } = await import("~/utils/helpers.server");
    safeFireAndForget(
            trackEvent({
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        event: "app_paywall_viewed",
        metadata: {
          triggerPage: "pixels_test",
          plan: shop.plan ?? "free",
          pixelConfigId: pixelConfigId,
          environment: pixelConfig?.environment || "test",
        },
      })
    );
  }
  const backendUrlInfo = getPixelEventIngestionUrl();
  return json({
    shop: { id: shop.id, domain: shop.shopDomain, plan: shop.plan },
    pixelConfig,
    hasVerificationAccess,
    backendUrlInfo,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = await i18nServer.getFixedT(request);
  const shopDomain = session.shop;
  const pixelConfigId = params.id;
  if (!pixelConfigId) {
    return json({ success: false, error: t("pixels.test.backendCheck.error.missingId") }, { status: 400 });
  }
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }
  const actionPlanId = normalizePlanId(shop.plan ?? "free");
  if (!planSupportsFeature(actionPlanId, "verification")) {
    return json({ success: false, error: "Plan upgrade required" }, { status: 403 });
  }
  const pixelConfig = await prisma.pixelConfig.findFirst({
    where: { id: pixelConfigId, shopId: shop.id },
    select: { platform: true },
  });
  if (!pixelConfig) {
    return json({ success: false, error: t("pixels.test.backendCheck.error.configNotFound") }, { status: 404 });
  }
  if (actionType === "validateTestEnvironment") {
    const platform = pixelConfig.platform;
    if (!["google", "meta", "tiktok"].includes(platform)) {
      return json({
        success: false,
        error: t("pixels.test.backendCheck.error.onlySupported"),
      }, { status: 400 });
    }
    try {
      const result = await validateTestEnvironment(shop.id, platform as "google" | "meta" | "tiktok");
      return json({ success: true, ...result });
    } catch (error) {
      return json({
        success: false,
        error: error instanceof Error ? error.message : t("pixels.test.backendCheck.error.verificationFailed"),
      }, { status: 500 });
    }
  }
  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

type ActionResult = { success: true; valid?: boolean; message?: string; details?: unknown } | { success: false; error: string };
export default function PixelTestPage() {
  const { t } = useTranslation();
  const { shop, pixelConfig, hasVerificationAccess, backendUrlInfo } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  useEffect(() => {
    if (!actionData) return;
    if (actionData.success && actionData.valid) {
      showSuccess(actionData.message || t("pixels.test.actions.validateSuccess"));
    } else if (actionData.success && actionData.valid === false) {
      showError(actionData.message || t("pixels.test.actions.validateFail"));
    } else if (actionData.success === false && "error" in actionData && actionData.error) {
      showError(actionData.error);
    }
  }, [actionData, showSuccess, showError, t]);
  if (!shop || !pixelConfig) {
    return (
      <Page title={t("pixels.test.title")}>
        <EnhancedEmptyState
          icon="⚠️"
          title={t("pixels.test.configNotFound.title")}
          description={t("pixels.test.configNotFound.desc")}
          primaryAction={{ content: t("pixels.test.configNotFound.action"), url: "/app/pixels" }}
        />
      </Page>
    );
  }
  if (!hasVerificationAccess) {
    return (
      <Page
        title={t("pixels.test.title")}
        backAction={{ content: t("pixels.test.backAction"), url: `/app/pixels` }}
      >
        <UpgradePrompt
          feature="verification"
          currentPlan={normalizePlanId(shop.plan ?? "free") as PlanId}
        />
      </Page>
    );
  }
  const handleValidate = () => {
    const formData = new FormData();
    formData.append("_action", "validateTestEnvironment");
    formData.append("platform", pixelConfig.platform);
    submit(formData, { method: "post" });
  };
  const isSubmitting = navigation.state === "submitting";
  return (
    <Page
      title={t("pixels.test.title")}
      subtitle={t("pixels.test.subtitle")}
      backAction={{ content: t("pixels.test.back"), url: "/app/pixels" }}
    >
      <PageIntroCard
        title={t("pixels.test.intro.title")}
        description={t("pixels.test.intro.desc")}
        items={[
          t("pixels.test.intro.items.0"),
          t("pixels.test.intro.items.1"),
          t("pixels.test.intro.items.2"),
        ]}
        primaryAction={{ content: t("pixels.test.back"), url: "/app/pixels" }}
        secondaryAction={{ content: t("pixels.test.intro.secondary"), url: "/app/verification" }}
      />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {PLATFORM_LABELS[pixelConfig.platform] || pixelConfig.platform}
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone={pixelConfig.environment === "live" ? "critical" : "warning"}>
                    {pixelConfig.environment === "live" ? t("pixels.list.env.prod") : t("pixels.list.env.test")}
                  </Badge>
                  <Badge>{`v${pixelConfig.configVersion}`}</Badge>
                </InlineStack>
              </InlineStack>
              <Text as="p" tone="subdued">
                {t("pixels.list.table.id")}: {pixelConfig.platformId || t("common.notSet") || "—"}
              </Text>
              <Divider />
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("pixels.test.backendCheck.title")}</Text>
                {backendUrlInfo.placeholderDetected ? (
                  <Banner tone="critical">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.placeholder.title")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {backendUrlInfo.warning || t("pixels.test.backendCheck.placeholder.desc")}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.placeholder.impact")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {t("pixels.test.backendCheck.placeholder.impactDesc")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("pixels.test.backendCheck.placeholder.fix")} {t("pixels.test.backendCheck.placeholder.fixDesc")}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.placeholder.checklist")}
                      </Text>
                      <List type="number">
                        <List.Item><Text as="span" variant="bodySm">{t("pixels.test.backendCheck.placeholder.steps.0")}</Text></List.Item>
                        <List.Item><Text as="span" variant="bodySm"><Trans i18nKey="pixels.test.backendCheck.placeholder.steps.1" components={{ code: <code /> }} /></Text></List.Item>
                        <List.Item><Text as="span" variant="bodySm">{t("pixels.test.backendCheck.placeholder.steps.2")}</Text></List.Item>
                        <List.Item><Text as="span" variant="bodySm">{t("pixels.test.backendCheck.placeholder.steps.3")}</Text></List.Item>
                        <List.Item><Text as="span" variant="bodySm" fontWeight="semibold"><strong>{t("pixels.test.backendCheck.placeholder.steps.4")}</strong></Text></List.Item>
                      </List>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.placeholder.serverUrl")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {(() => {
                          try {
                            const url = new URL(backendUrlInfo.url);
                            const hostname = url.hostname;
                            if (hostname.length > 30) {
                              return hostname.substring(0, 20) + "..." + hostname.substring(hostname.length - 10);
                            }
                            return hostname;
                          } catch {
                            return backendUrlInfo.url.substring(0, 30) + "...";
                          }
                        })()}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.placeholder.pixelUrl")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {backendUrlInfo.pixelExtensionUrl ? (() => {
                          try {
                            const url = new URL(backendUrlInfo.pixelExtensionUrl);
                            const hostname = url.hostname;
                            if (hostname.length > 30) {
                              return hostname.substring(0, 20) + "..." + hostname.substring(hostname.length - 10);
                            }
                            return hostname;
                          } catch {
                            return backendUrlInfo.pixelExtensionUrl.substring(0, 50) + "...";
                          }
                        })() : t("pixels.test.backendCheck.placeholder.notConfigured")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        💡 {t("pixels.test.backendCheck.placeholder.note")}
                      </Text>
                    </BlockStack>
                  </Banner>
                ) : backendUrlInfo.isConfigured ? (
                  <Banner tone={backendUrlInfo.isLocalhost ? "warning" : "success"}>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.configured.status")}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.configured.serverUrl")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {(() => {
                          try {
                            const url = new URL(backendUrlInfo.url);
                            const hostname = url.hostname;
                            if (hostname.length > 30) {
                              return hostname.substring(0, 20) + "..." + hostname.substring(hostname.length - 10);
                            }
                            return hostname;
                          } catch {
                            return backendUrlInfo.url.substring(0, 50) + "...";
                          }
                        })()}
                      </Text>
                      {backendUrlInfo.allowlistStatus && (
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            {t("pixels.test.backendCheck.configured.allowlist.title")}
                          </Text>
                          <Text as="p" variant="bodySm">
                            {backendUrlInfo.allowlistStatus.inAllowlist ? t("pixels.test.backendCheck.configured.allowlist.ok") : t("pixels.test.backendCheck.configured.allowlist.fail")}
                          </Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            {t("pixels.test.backendCheck.configured.allowlist.pixelHostname")}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {backendUrlInfo.allowlistStatus.pixelExtensionHostname || backendUrlInfo.allowlistStatus.hostname || "—"}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("pixels.test.backendCheck.configured.note")}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                             {t("pixels.test.backendCheck.configured.allowlist.allowedHosts")} {backendUrlInfo.allowlistStatus.allowedHosts.length > 0 ? backendUrlInfo.allowlistStatus.allowedHosts.join(", ") : "—"}
                          </Text>
                          {!backendUrlInfo.allowlistStatus.inAllowlist && (
                            <Text as="p" variant="bodySm" tone="critical">
                              {t("pixels.test.backendCheck.configured.allowlist.warning")}
                            </Text>
                          )}
                        </BlockStack>
                      )}
                      {backendUrlInfo.warning && (
                        <Text as="p" variant="bodySm">
                          {backendUrlInfo.warning}
                        </Text>
                      )}
                    </BlockStack>
                  </Banner>
                ) : (
                  <Banner tone="critical">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.error.title")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {backendUrlInfo.warning || t("pixels.test.backendCheck.error.desc")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("pixels.test.backendCheck.error.fix")}
                      </Text>
                    </BlockStack>
                  </Banner>
                )}
              </BlockStack>
              <Divider />
              <Banner tone="warning">
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("pixels.test.sandbox.title")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("pixels.test.sandbox.desc")}
                  </Text>
                  <List type="bullet">
                    <List.Item><Text as="span" variant="bodySm">{t("pixels.test.sandbox.items.0")}</Text></List.Item>
                    <List.Item><Text as="span" variant="bodySm">{t("pixels.test.sandbox.items.1")}</Text></List.Item>
                    <List.Item><Text as="span" variant="bodySm">{t("pixels.test.sandbox.items.2")}</Text></List.Item>
                  </List>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("pixels.test.sandbox.note")}
                  </Text>
                </BlockStack>
              </Banner>
              <Divider />
              {pixelConfig.environment === "test" ? (
                <InlineStack gap="200" wrap>
                  <Button
                    variant="primary"
                    onClick={handleValidate}
                    loading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    {t("pixels.test.actions.sendTestEvent")}
                  </Button>
                  <Button url={`/app/pixels/${pixelConfig.id}/versions`} variant="plain">
                    {t("pixels.test.actions.history")}
                  </Button>
                </InlineStack>
              ) : (
                <Banner tone="warning" title={t("pixels.list.env.prod")}>
                  <Text as="p" variant="bodySm">
                    {t("pixels.test.actions.liveWarning")}
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("pixels.test.officialGuide.title")}</Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("pixels.test.officialGuide.intro.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("pixels.test.officialGuide.intro.desc")}
                  </Text>
                  <Link url="https://help.shopify.com/en/manual/promoting-marketing/pixels/custom-pixels/testing" external>
                    {t("pixels.test.officialGuide.intro.link")}
                  </Link>
                </BlockStack>
              </Banner>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">{t("pixels.test.officialGuide.checklist.title")}</Text>
                <Banner tone="success">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("pixels.test.officialGuide.checklist.banner")}
                  </Text>
                </Banner>
                <List type="number">
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.officialGuide.checklist.step1.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step1.action")}</strong>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step1.verify")}</strong>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step1.note")}</strong>
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.officialGuide.checklist.step2.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step2.action")}</strong>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step2.verify")}</strong>
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.officialGuide.checklist.step3.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step3.action")}</strong>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step3.verify")}</strong>
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.officialGuide.checklist.step4.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step4.action")}</strong>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step4.verify")}</strong>
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.officialGuide.checklist.step5.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step5.action")}</strong>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>{t("pixels.test.officialGuide.checklist.step5.verify")}</strong>
                      </Text>
                    </BlockStack>
                  </List.Item>
                </List>
                <Divider />
                <Text as="h3" variant="headingSm">{t("pixels.test.officialGuide.tips.title")}</Text>
                <List type="bullet">
                  <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.tips.items.0")}</Text></List.Item>
                  <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.tips.items.1")}</Text></List.Item>
                  <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.tips.items.2")}</Text></List.Item>
                </List>
                <Divider />
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.officialGuide.safety.title")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("pixels.test.officialGuide.safety.desc")}
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.officialGuide.safety.loadTest.title")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("pixels.test.officialGuide.safety.loadTest.desc")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>{t("pixels.test.officialGuide.safety.loadTest.method")}</strong>
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.officialGuide.safety.loadTest.criteria")}
                    </Text>
                    <List type="bullet">
                      <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.safety.loadTest.items.0")}</Text></List.Item>
                      <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.safety.loadTest.items.1")}</Text></List.Item>
                      <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.safety.loadTest.items.2")}</Text></List.Item>
                      <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.safety.loadTest.items.3")}</Text></List.Item>
                    </List>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.officialGuide.safety.nullOrigin.title")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("pixels.test.officialGuide.safety.nullOrigin.desc")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>{t("pixels.test.officialGuide.safety.nullOrigin.method")}</strong>
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>{t("pixels.test.officialGuide.safety.nullOrigin.env")}</strong>
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.officialGuide.safety.nullOrigin.criteria")}
                    </Text>
                    <List type="bullet">
                      <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.safety.nullOrigin.items.0")}</Text></List.Item>
                      <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.safety.nullOrigin.items.1")}</Text></List.Item>
                      <List.Item><Text as="span" variant="bodySm">{t("pixels.test.officialGuide.safety.nullOrigin.items.2")}</Text></List.Item>
                    </List>
                  </BlockStack>
                </Banner>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
