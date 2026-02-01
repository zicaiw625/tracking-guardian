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
import { normalizePlanId, planSupportsFeature } from "~/services/billing/plans";
import { getPixelEventIngestionUrl } from "~/utils/config.server";
import { useTranslation, Trans } from "react-i18next";


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
    shop: { id: shop.id, domain: shop.shopDomain },
    pixelConfig,
    hasVerificationAccess,
    backendUrlInfo,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const pixelConfigId = params.id;
  if (!pixelConfigId) {
    return json({ success: false, error: "Missing config ID" }, { status: 400 });
  }
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }
  const pixelConfig = await prisma.pixelConfig.findFirst({
    where: { id: pixelConfigId, shopId: shop.id },
    select: { platform: true },
  });
  if (!pixelConfig) {
    return json({ success: false, error: "Configuration not found" }, { status: 404 });
  }
  if (actionType === "validateTestEnvironment") {
    const platform = pixelConfig.platform;
    if (!["google", "meta", "tiktok"].includes(platform)) {
      return json({
        success: false,
        error: "Currently only supports test environment verification for GA4, Meta, and TikTok.",
      }, { status: 400 });
    }
    try {
      const result = await validateTestEnvironment(shop.id, platform as "google" | "meta" | "tiktok");
      return json({ success: true, ...result });
    } catch (error) {
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Verification failed",
      }, { status: 500 });
    }
  }
  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

type ActionResult = { success: true; valid?: boolean; message?: string; details?: unknown } | { success: false; error: string };

export default function PixelTestPage() {
  const { shop, pixelConfig, backendUrlInfo } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  const { t } = useTranslation();

  useEffect(() => {
    if (!actionData) return;

    const getMessage = (msg: string) => {
      const parts = msg.split(":");
      const code = parts[0];
      const error = parts.slice(1).join(":");

      switch (code) {
        case "CONFIG_NOT_FOUND": return t("pixels.test.validation.configNotFound");
        case "ENV_NOT_TEST": return t("pixels.test.validation.envNotTest");
        case "CREDENTIALS_NOT_CONFIGURED": return t("pixels.test.validation.credentialsNotConfigured");
        case "CREDENTIALS_INVALID": return t("pixels.test.validation.credentialsInvalid", { error });
        case "EVENT_SENT_SUCCESS": return t("pixels.test.validation.eventSentSuccess");
        case "EVENT_SENT_FAILED": return t("pixels.test.validation.eventSentFailed", { error });
        case "VERIFICATION_ERROR": return t("pixels.test.validation.verificationError", { error });
        case "PLATFORM_NOT_SUPPORTED": return t("pixels.test.errors.platformNotSupported");
        case "VERIFICATION_FAILED": return t("pixels.test.errors.verificationFailed");
        default: return msg;
      }
    };

    if (actionData.success && actionData.valid) {
      showSuccess(getMessage(actionData.message || "EVENT_SENT_SUCCESS"));
    } else if (actionData.success && actionData.valid === false) {
      showError(getMessage(actionData.message || "VERIFICATION_FAILED"));
    } else if (actionData.success === false && "error" in actionData && actionData.error) {
      showError(getMessage(actionData.error));
    }
  }, [actionData, showSuccess, showError, t]);

  if (!shop || !pixelConfig) {
    return (
      <Page title={t("pixels.test.title")}>
        <EnhancedEmptyState
          icon="⚠️"
          title={t("pixels.test.empty.title")}
          description={t("pixels.test.empty.description")}
          primaryAction={{ content: t("pixels.test.back"), url: "/app/pixels" }}
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
        description={t("pixels.test.intro.description")}
        items={t("pixels.test.intro.items", { returnObjects: true }) as string[]}
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
                    {pixelConfig.environment === "live" ? t("pixels.test.labels.prod") : t("pixels.test.labels.test")}
                  </Badge>
                  <Badge>{`v${pixelConfig.configVersion}`}</Badge>
                </InlineStack>
              </InlineStack>
              <Text as="p" tone="subdued">
                {t("pixels.test.labels.platformId")}：{pixelConfig.platformId || t("pixels.test.labels.notSet")}
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
                        {backendUrlInfo.warning || t("pixels.test.backendCheck.placeholder.warning")}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.placeholder.impactTitle")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {t("pixels.test.backendCheck.placeholder.impactDesc")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("pixels.test.backendCheck.placeholder.fix")}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.placeholder.checklistTitle")}
                      </Text>
                      <List type="number">
                         {(t("pixels.test.backendCheck.placeholder.items", { returnObjects: true }) as string[]).map((item, index) => (
                           <List.Item key={index}>
                             <Text as="span" variant="bodySm">
                               <Trans i18nKey={`pixels.test.backendCheck.placeholder.items.${index}`} components={{ code: <code />, strong: <strong /> }} />
                             </Text>
                           </List.Item>
                         ))}
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
                        {t("pixels.test.backendCheck.placeholder.extensionUrl")}
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
                        {t("pixels.test.backendCheck.placeholder.explanation")}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.verifyBeforeLaunch.title")}
                      </Text>
                      <List type="number">
                        {(t("pixels.test.backendCheck.verifyBeforeLaunch.items", { returnObjects: true }) as string[]).map((item, index) => (
                            <List.Item key={index}>
                              <Text as="span" variant="bodySm">
                                {item}
                              </Text>
                            </List.Item>
                          ))}
                      </List>
                    </BlockStack>
                  </Banner>
                ) : backendUrlInfo.isConfigured ? (
                  <Banner tone={backendUrlInfo.isLocalhost ? "warning" : "success"}>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.status.title")}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.placeholder.serverUrl")}
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
                            {t("pixels.test.backendCheck.status.allowlistTitle")}
                          </Text>
                          <Text as="p" variant="bodySm">
                            {backendUrlInfo.allowlistStatus.inAllowlist ? t("pixels.test.backendCheck.status.configured") : t("pixels.test.backendCheck.status.verify")}
                          </Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            {t("pixels.test.backendCheck.placeholder.extensionUrl")}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {backendUrlInfo.allowlistStatus.pixelExtensionHostname || backendUrlInfo.allowlistStatus.hostname || t("pixels.test.backendCheck.status.notResolved")}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("pixels.test.backendCheck.placeholder.explanation")}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("pixels.test.backendCheck.status.allowedHosts")}{backendUrlInfo.allowlistStatus.allowedHosts.length > 0 ? backendUrlInfo.allowlistStatus.allowedHosts.join(", ") : t("pixels.test.backendCheck.status.none")}
                          </Text>
                          {!backendUrlInfo.allowlistStatus.inAllowlist && (
                            <Text as="p" variant="bodySm" tone="critical">
                              {t("pixels.test.backendCheck.status.warning")}
                            </Text>
                          )}
                        </BlockStack>
                      )}
                      {backendUrlInfo.warning && (
                        <Text as="p" variant="bodySm">
                          {backendUrlInfo.warning}
                        </Text>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">
                         {t("pixels.test.backendCheck.placeholder.explanation")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("pixels.test.backendCheck.placeholder.explanation")}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.verifyBeforeLaunch.title")}
                      </Text>
                      <List type="bullet">
                        {(t("pixels.test.backendCheck.verifyBeforeLaunch.items", { returnObjects: true }) as string[]).map((item, index) => (
                          <List.Item key={index}>
                            <Text as="span" variant="bodySm">
                              {item}
                            </Text>
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  </Banner>
                ) : (
                  <Banner tone="critical">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.backendCheck.status.critical")}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {backendUrlInfo.warning || t("pixels.test.backendCheck.status.criticalDesc")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("pixels.test.backendCheck.placeholder.fix")}
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
                    {t("pixels.test.sandbox.description")}
                  </Text>
                  <List type="bullet">
                    {(t("pixels.test.sandbox.items", { returnObjects: true }) as string[]).map((item, index) => (
                      <List.Item key={index}>
                        <Text as="span" variant="bodySm">
                          <Trans i18nKey={`pixels.test.sandbox.items.${index}`} components={{ strong: <strong /> }} />
                        </Text>
                      </List.Item>
                    ))}
                  </List>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("pixels.test.sandbox.tip")}
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
                    {t("pixels.test.actions.sendTest")}
                  </Button>
                  <Button url={`/app/pixels/${pixelConfig.id}/versions`} variant="plain">
                    {t("pixels.test.actions.viewHistory")}
                  </Button>
                </InlineStack>
              ) : (
                <Banner tone="warning" title={t("pixels.test.actions.prodWarning")}>
                  <Text as="p" variant="bodySm">
                    {t("pixels.test.actions.prodDesc")}
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("pixels.test.guide.title")}</Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("pixels.test.guide.subtitle")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("pixels.test.guide.description")}
                  </Text>
                  <Link url="https://help.shopify.com/en/manual/online-store/themes/customizing-themes/checkout-extensibility/web-pixels-api/test-custom-pixels" external>
                    {t("pixels.test.guide.link")}
                  </Link>
                </BlockStack>
              </Banner>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">{t("pixels.test.checklist.title")}</Text>
                <Banner tone="success">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("pixels.test.checklist.banner")}
                  </Text>
                </Banner>
                <List type="number">
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.checklist.checkoutStarted.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.checkoutStarted.action" components={{ strong: <strong /> }} />
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.checkoutStarted.verify" components={{ strong: <strong /> }} />
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.checkoutStarted.note" components={{ strong: <strong /> }} />
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.checklist.shippingInfo.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.shippingInfo.action" components={{ strong: <strong /> }} />
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                         <Trans i18nKey="pixels.test.checklist.shippingInfo.verify" components={{ strong: <strong /> }} />
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.checklist.completed.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.completed.action" components={{ strong: <strong /> }} />
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.completed.verify" components={{ strong: <strong /> }} />
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.completed.note" components={{ strong: <strong /> }} />
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.checklist.payload.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.payload.action" components={{ strong: <strong /> }} />
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.payload.verify" components={{ strong: <strong /> }} />
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {t("pixels.test.checklist.platform.title")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.platform.action" components={{ strong: <strong /> }} />
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <Trans i18nKey="pixels.test.checklist.platform.verify" components={{ strong: <strong /> }} />
                      </Text>
                    </BlockStack>
                  </List.Item>
                </List>
                <Divider />
                <Text as="h3" variant="headingSm">{t("pixels.test.checklist.tips.title")}</Text>
                <List type="bullet">
                  {(t("pixels.test.checklist.tips.items", { returnObjects: true }) as string[]).map((item, index) => (
                    <List.Item key={index}>
                      <Text as="span" variant="bodySm">
                        {item}
                      </Text>
                    </List.Item>
                  ))}
                </List>
                <Divider />
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.safety.title")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <Trans i18nKey="pixels.test.safety.description" components={{ strong: <strong /> }} />
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.safety.loadTest.title")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <Trans i18nKey="pixels.test.safety.loadTest.description" components={{ code: <code />, strong: <strong /> }} />
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.safety.standardsTitle")}
                    </Text>
                    <List type="bullet">
                        {(t("pixels.test.safety.loadTest.standards", { returnObjects: true }) as string[]).map((item, index) => (
                        <List.Item key={index}>
                          <Text as="span" variant="bodySm">
                            {item}
                          </Text>
                        </List.Item>
                      ))}
                    </List>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.safety.nullOrigin.title")}
                    </Text>
                    <Text as="p" variant="bodySm">
                       <Trans i18nKey="pixels.test.safety.nullOrigin.description" components={{ code: <code />, strong: <strong /> }} />
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <Trans i18nKey="pixels.test.safety.nullOrigin.config" components={{ code: <code />, strong: <strong /> }} />
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {t("pixels.test.safety.standardsTitle")}
                    </Text>
                    <List type="bullet">
                       {(t("pixels.test.safety.nullOrigin.standards", { returnObjects: true }) as string[]).map((item, index) => (
                        <List.Item key={index}>
                          <Text as="span" variant="bodySm">
                            {item}
                          </Text>
                        </List.Item>
                      ))}
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
