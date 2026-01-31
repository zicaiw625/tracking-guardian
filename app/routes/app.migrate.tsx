import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  ProgressBar,
  Badge,
  Layout,
  Divider,
  List,
} from "@shopify/polaris";
import { getShopifyAdminUrl } from "../utils/helpers";
import { CheckCircleIcon, ArrowRightIcon, LockIcon } from "~/components/icons";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { useLocale } from "~/context/LocaleContext";
import { CheckoutCompletedBehaviorHint } from "~/components/verification/CheckoutCompletedBehaviorHint";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";
import { validateTestEnvironment, saveWizardDraft, clearWizardDraft } from "../services/migration-wizard.server";
import { getLocaleFromRequest } from "../utils/locale.server";

type MigrationStep = "audit" | "pixels" | "modules" | "verification";

interface StepStatus {
  completed: boolean;
  inProgress: boolean;
  canAccess: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const { checkCustomerAccountsEnabled } = await import("../services/customer-accounts.server");
  const customerAccountsStatus = await checkCustomerAccountsEnabled(admin);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      webPixelId: true,
      pixelConfigs: {
        where: { isActive: true },
        select: { platform: true, environment: true },
        take: 1,
      },
    },
  });

  if (!shop) {
    return json({
      shop: null,
      planId: "free" as PlanId,
      steps: {
        audit: { completed: false, inProgress: false, canAccess: true },
        pixels: { completed: false, inProgress: false, canAccess: false },
        modules: { completed: false, inProgress: false, canAccess: false },
        verification: { completed: false, inProgress: false, canAccess: false },
      },
      customerAccountsStatus: { enabled: false },
    });
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const latestScan = await prisma.scanReport.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const hasPixels = shop.pixelConfigs.length > 0;
  const hasWebPixel = !!shop.webPixelId;

  const uiModules = await prisma.shop.findUnique({
    where: { id: shop.id },
    select: { settings: true },
  });
  const settings = (uiModules?.settings as Record<string, unknown>) || {};
  const uiModulesConfig = (settings.uiModules as Record<string, unknown>) || {};
  const hasEnabledModules =
    (settings.uiModules as Record<string, unknown> | undefined)?.done === true ||
    Object.values(uiModulesConfig).some(
      (module: unknown) => module && typeof module === "object" && "isEnabled" in module && (module as { isEnabled: boolean }).isEnabled
    );

  const latestVerification = await prisma.verificationRun.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const steps: Record<MigrationStep, StepStatus> = {
    audit: {
      completed: !!latestScan,
      inProgress: false,
      canAccess: true,
    },
    pixels: {
      completed: hasPixels && hasWebPixel,
      inProgress: false,
      canAccess: isPlanAtLeast(planId, "starter"),
    },
    modules: {
      completed: hasEnabledModules,
      inProgress: false,
      canAccess: isPlanAtLeast(planId, "starter"),
    },
    verification: {
      completed: !!latestVerification && latestVerification.status === "completed",
      inProgress: false,
      canAccess: isPlanAtLeast(planId, "starter"),
    },
  };

  return json({
    shop: { id: shop.id, domain: shopDomain },
    planId,
    steps,
    customerAccountsStatus: { enabled: customerAccountsStatus.enabled },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const locale = getLocaleFromRequest(request);
  const isZh = locale === "zh";
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }
  const formData = await request.formData();
  const actionType = formData.get("_action");
  if (actionType === "validateTestEnvironment") {
    const platform = formData.get("platform") as string | null;
    if (!platform || !["google", "meta", "tiktok"].includes(platform)) {
      return json({
        valid: false,
        message: isZh ? "无效或缺失的 platform 参数" : "Invalid or missing platform parameter",
      });
    }
    try {
      const result = await validateTestEnvironment(shop.id, platform as "google" | "meta" | "tiktok", locale);
      return json(result);
    } catch (error) {
      return json({
        valid: false,
        message: error instanceof Error ? error.message : (isZh ? "验证失败" : "Validation failed"),
        details: { eventSent: false, error: error instanceof Error ? error.message : (isZh ? "验证失败" : "Validation failed") },
      }, { status: 500 });
    }
  }
  if (actionType === "saveWizardDraft") {
    const draftRaw = formData.get("draft");
    if (typeof draftRaw !== "string") {
      return json({ success: false, error: isZh ? "缺少 draft 参数" : "Missing draft parameter" }, { status: 400 });
    }
    let draft: Parameters<typeof saveWizardDraft>[1];
    try {
      draft = JSON.parse(draftRaw) as Parameters<typeof saveWizardDraft>[1];
    } catch {
      return json({ success: false, error: isZh ? "draft 格式无效" : "Invalid draft format" }, { status: 400 });
    }
    const result = await saveWizardDraft(shop.id, draft);
    return json(result.success ? { success: true } : { success: false, error: result.error });
  }
  if (actionType === "clearWizardDraft") {
    const result = await clearWizardDraft(shop.id);
    return json({ success: result.success });
  }
  if (actionType === "markModulesStepDone") {
    const shopRow = await prisma.shop.findUnique({
      where: { id: shop.id },
      select: { settings: true },
    });
    const settings = (shopRow?.settings as Record<string, unknown>) || {};
    const updated = {
      ...settings,
      uiModules: { thankYou: { isEnabled: true }, orderStatus: { isEnabled: true } },
    };
    await prisma.shop.update({
      where: { id: shop.id },
      data: { settings: updated as object },
    });
    return json({ success: true });
  }
  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

export default function MigratePage() {
  const { shop, planId, steps, customerAccountsStatus } = useLoaderData<typeof loader>();

  const getStepProgress = () => {
    const completedCount = Object.values(steps).filter((s) => s.completed).length;
    return (completedCount / Object.keys(steps).length) * 100;
  };

  const { t } = useLocale();
  const progress = getStepProgress();

  const stepConfigs = [
    {
      id: "audit" as MigrationStep,
      title: t("migrate.step1Title"),
      description: t("migrate.step1Desc"),
      url: "/app/scan",
      icon: CheckCircleIcon,
    },
    {
      id: "pixels" as MigrationStep,
      title: t("migrate.step2Title"),
      description: t("migrate.step2Desc"),
      url: "/app/pixels/new",
      icon: CheckCircleIcon,
      requiresPlan: "starter" as PlanId,
    },
    {
      id: "modules" as MigrationStep,
      title: t("migrate.step3Title"),
      description: t("migrate.step3Desc"),
      requiresPlan: "starter" as PlanId,
      isModulesStep: true,
    },
    {
      id: "verification" as MigrationStep,
      title: t("migrate.step4Title"),
      description: t("migrate.step4Desc"),
      url: "/app/verification",
      icon: CheckCircleIcon,
      requiresPlan: "starter" as PlanId,
    },
  ];

  if (!shop) {
    return (
      <Page title={t("migrate.pageTitle")}>
        <Banner tone="critical" title={t("migrate.noShopTitle")}>
          <Text as="p" variant="bodySm">
            {t("migrate.noShopHint")}
          </Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page title={t("migrate.pageTitle")} subtitle={t("migrate.pageSubtitle")}>
      <BlockStack gap="500">
        <PageIntroCard
          title={t("migrate.introTitle")}
          description={t("migrate.introDesc")}
          items={[t("migrate.introItems.0"), t("migrate.introItems.1"), t("migrate.introItems.2"), t("migrate.introItems.3")]}
          primaryAction={{ content: t("migrate.startMigration"), url: "/app/scan" }}
        />
        <Banner tone="critical">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              ⚠️ {t("migrate.backendUrlBannerTitle")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("migrate.backendUrlBannerP1")}
            </Text>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("migrate.backendUrlBannerDeploy")}
            </Text>
            <List type="number">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.backendUrlStep1")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.backendUrlStep2")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.backendUrlStep3")}
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              💡 {t("migrate.backendUrlTip")}
            </Text>
          </BlockStack>
        </Banner>
        <Banner tone="warning">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              ⚠️ {t("migrate.strictSandboxTitle")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("migrate.strictSandboxP1")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.strictSandboxNoDom")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.strictSandboxNullFields")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.strictSandboxWebhooks")}
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              💡 {t("migrate.strictSandboxTip")}
            </Text>
          </BlockStack>
        </Banner>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {t("migrate.progressTitle")}
              </Text>
              <Badge tone={progress === 100 ? "success" : progress > 0 ? "info" : undefined}>
                {`${Math.round(progress)}%`}
              </Badge>
            </InlineStack>
            <ProgressBar progress={progress} tone={progress === 100 ? "success" : undefined} />
            <Text as="p" variant="bodySm" tone="subdued">
              {t("migrate.stepsCompleted", { done: Object.values(steps).filter((s) => s.completed).length, total: Object.keys(steps).length })}
            </Text>
          </BlockStack>
        </Card>

        <Layout>
          {stepConfigs.map((stepConfig, index) => {
            const stepStatus = steps[stepConfig.id];
            const canAccess = stepConfig.requiresPlan
              ? isPlanAtLeast(planId, stepConfig.requiresPlan) && stepStatus.canAccess
              : stepStatus.canAccess;
            const isModulesStep = "isModulesStep" in stepConfig && stepConfig.isModulesStep === true;

            return (
              <Layout.Section key={stepConfig.id} variant="oneHalf">
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          {stepStatus.completed ? (
                            <CheckCircleIcon />
                          ) : (
                            <Text as="span" variant="headingLg" fontWeight="bold">
                              {index + 1}
                            </Text>
                          )}
                          <Text as="h3" variant="headingSm">
                            {stepConfig.title}
                          </Text>
                          {stepStatus.completed && <Badge tone="success">{t("migrate.completed")}</Badge>}
                          {!canAccess && stepConfig.requiresPlan && (
                            <Badge tone="warning">
                              {stepConfig.requiresPlan === "starter" ? t("migrate.needStarter") : t("migrate.needUpgrade")}
                            </Badge>
                          )}
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {stepConfig.description}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <Divider />
                    {isModulesStep && customerAccountsStatus?.enabled === false && (
                      <Banner tone="warning" title={t("migrate.orderStatusBannerTitle")}>
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm">
                            {t("migrate.orderStatusBannerDesc")}
                          </Text>
                          <Button
                            url={shop ? getShopifyAdminUrl(shop.domain, "/settings/checkout") : "#"}
                            external
                            size="slim"
                          >
                            {t("migrate.openCheckoutSettings")}
                          </Button>
                        </BlockStack>
                      </Banner>
                    )}
                    {isModulesStep && canAccess && !stepStatus.completed && (
                      <>
                        <List type="number">
                          <List.Item>{t("migrate.listItem1")}</List.Item>
                          <List.Item>{t("migrate.listItem2")}</List.Item>
                          <List.Item>{t("migrate.listItem3")}</List.Item>
                          <List.Item>{t("migrate.listItem4")}</List.Item>
                        </List>
                        <InlineStack gap="200">
                          <Button
                            url={shop ? getShopifyAdminUrl(shop.domain, "/settings/checkout") : "#"}
                            external
                          >
                            {t("migrate.checkoutSettings")}
                          </Button>
                          <Button
                            url={shop ? getShopifyAdminUrl(shop.domain, "/themes/current/editor") : "#"}
                            external
                          >
                            {t("migrate.themeEditor")}
                          </Button>
                        </InlineStack>
                        <img
                          src="/images/checkout-editor-step-1.svg"
                          alt={t("migrate.checkoutEditorAlt")}
                          style={{ maxWidth: "100%", height: "auto" }}
                        />
                        <Form method="post">
                          <input type="hidden" name="_action" value="markModulesStepDone" />
                          <Button submit variant="primary">
                            {t("migrate.iHaveAddedBlock")}
                          </Button>
                        </Form>
                      </>
                    )}
                    {(!isModulesStep || stepStatus.completed || !canAccess) && (
                      <InlineStack align="end">
                        {canAccess ? (
                          isModulesStep && stepStatus.completed ? (
                            <Button url="/app/verification" variant="secondary">
                              {t("migrate.nextVerification")}
                            </Button>
                          ) : !isModulesStep ? (
                            <Button
                              url={stepConfig.url}
                              variant={stepStatus.completed ? "secondary" : "primary"}
                              icon={stepStatus.completed ? undefined : ArrowRightIcon}
                            >
                              {stepStatus.completed ? t("migrate.viewDetails") : t("migrate.start")}
                            </Button>
                          ) : null
                        ) : (
                          <Button
                            url="/app/billing"
                            variant="secondary"
                            icon={LockIcon}
                          >
                            {t("migrate.upgradeUnlock")}
                          </Button>
                        )}
                      </InlineStack>
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>

        {progress === 100 && (
          <Banner tone="success" title={t("migrate.migrationCompleteTitle")}>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                {t("migrate.migrationCompleteDesc")}
              </Text>
              <InlineStack gap="200">
                <Button url="/app/verification" variant="primary">
                  {t("migrate.runVerification")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("migrate.stepsDescriptionTitle")}
            </Text>
            <Divider />
            <List type="number">
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("migrate.step1DetailTitle")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("migrate.step1DetailDesc")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("migrate.step2DetailTitle")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("migrate.step2DetailDesc")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("migrate.step3DetailTitle")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("migrate.step3DetailDesc")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("migrate.step4DetailTitle")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("migrate.step4DetailDesc")}
                  </Text>
                </BlockStack>
              </List.Item>
            </List>
          </BlockStack>
        </Card>

        <CheckoutCompletedBehaviorHint mode="info" collapsible={true} />
        <Banner tone="info" title={t("migrate.importantNotice")}>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("migrate.shopifyDeadline")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>{t("migrate.importantNotice")}:</strong> {t("migrate.shopifyDeadlineDesc")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.plusDeadline")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.nonPlusDeadline")}
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("migrate.migrateEarly")}
            </Text>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Page>
  );
}
