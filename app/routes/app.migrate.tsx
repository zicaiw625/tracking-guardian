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
import { CheckoutCompletedBehaviorHint } from "~/components/verification/CheckoutCompletedBehaviorHint";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";
import { validateTestEnvironment, saveWizardDraft, clearWizardDraft } from "../services/migration-wizard.server";
import { useTranslation, Trans } from "react-i18next";

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
        message: "migrate.errors.invalidPlatform",
      });
    }
    try {
      const result = await validateTestEnvironment(shop.id, platform as "google" | "meta" | "tiktok");
      return json(result);
    } catch (error) {
      return json({
        valid: false,
        message: error instanceof Error ? error.message : "migrate.errors.validationFailed",
        details: { eventSent: false, error: error instanceof Error ? error.message : "migrate.errors.validationFailed" },
      }, { status: 500 });
    }
  }
  if (actionType === "saveWizardDraft") {
    const draftRaw = formData.get("draft");
    if (typeof draftRaw !== "string") {
      return json({ success: false, error: "migrate.errors.missingDraft" }, { status: 400 });
    }
    let draft: Parameters<typeof saveWizardDraft>[1];
    try {
      draft = JSON.parse(draftRaw) as Parameters<typeof saveWizardDraft>[1];
    } catch {
      return json({ success: false, error: "migrate.errors.invalidDraft" }, { status: 400 });
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
  const { t } = useTranslation();
  const { shop, planId, steps, customerAccountsStatus } = useLoaderData<typeof loader>();

  const getStepProgress = () => {
    const completedCount = Object.values(steps).filter((s) => s.completed).length;
    return (completedCount / Object.keys(steps).length) * 100;
  };

  const progress = getStepProgress();

  const stepConfigs = [
    {
      id: "audit" as MigrationStep,
      title: t("migrate.steps.audit.title"),
      description: t("migrate.steps.audit.description"),
      url: "/app/scan",
      icon: CheckCircleIcon,
    },
    {
      id: "pixels" as MigrationStep,
      title: t("migrate.steps.pixels.title"),
      description: t("migrate.steps.pixels.description"),
      url: "/app/pixels/new",
      icon: CheckCircleIcon,
      requiresPlan: "starter" as PlanId,
    },
    {
      id: "modules" as MigrationStep,
      title: t("migrate.steps.modules.title"),
      description: t("migrate.steps.modules.description"),
      requiresPlan: "starter" as PlanId,
      isModulesStep: true,
    },
    {
      id: "verification" as MigrationStep,
      title: t("migrate.steps.verification.title"),
      description: t("migrate.steps.verification.description"),
      url: "/app/verification",
      icon: CheckCircleIcon,
      requiresPlan: "starter" as PlanId,
    },
  ];

  if (!shop) {
    return (
      <Page title={t("migrate.title")}>
        <Banner tone="critical" title={t("migrate.errors.shopNotFound")}>
          <Text as="p" variant="bodySm">
            {t("migrate.errors.appInstalled")}
          </Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page title={t("migrate.title")} subtitle={t("migrate.subtitle")}>
      <BlockStack gap="500">
        <PageIntroCard
          title={t("migrate.intro.title")}
          description={t("migrate.intro.description")}
          items={[
            t("migrate.intro.items.0"),
            t("migrate.intro.items.1"),
            t("migrate.intro.items.2"),
            t("migrate.intro.items.3"),
          ]}
          primaryAction={{ content: t("migrate.intro.action"), url: "/app/scan" }}
        />
        <Banner tone="critical">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("migrate.banner.backendUrl.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("migrate.banner.backendUrl.desc")}
            </Text>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("migrate.banner.backendUrl.requirements")}
            </Text>
            <List type="number">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <Trans i18nKey="migrate.banner.backendUrl.steps.0" components={{ code: <code /> }} />
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <Trans i18nKey="migrate.banner.backendUrl.steps.1" components={{ code: <code /> }} />
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.banner.backendUrl.steps.2")}
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("migrate.banner.backendUrl.tip")}
            </Text>
          </BlockStack>
        </Banner>
        <Banner tone="warning">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("migrate.banner.sandbox.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("migrate.banner.sandbox.desc")}
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.banner.sandbox.limitations.0")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.banner.sandbox.limitations.1")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.banner.sandbox.limitations.2")}
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("migrate.banner.sandbox.tip")}
            </Text>
          </BlockStack>
        </Banner>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {t("migrate.progress.title")}
              </Text>
              <Badge tone={progress === 100 ? "success" : progress > 0 ? "info" : undefined}>
                {`${Math.round(progress)}%`}
              </Badge>
            </InlineStack>
            <ProgressBar progress={progress} tone={progress === 100 ? "success" : undefined} />
            <Text as="p" variant="bodySm" tone="subdued">
              {t("migrate.progress.stepsCompleted", { completed: Object.values(steps).filter((s) => s.completed).length, total: Object.keys(steps).length })}
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
                          {stepStatus.completed && <Badge tone="success">{t("migrate.buttons.completed")}</Badge>}
                          {!canAccess && stepConfig.requiresPlan && (
                            <Badge tone="warning">
                              {stepConfig.requiresPlan === "starter" ? t("migrate.buttons.requiresStarter") : t("migrate.buttons.requiresUpgrade")}
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
                      <Banner tone="warning" title={t("migrate.steps.modules.warning")}>
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm">
                            {t("migrate.steps.modules.warningDesc")}
                          </Text>
                          <Button
                            url={shop ? getShopifyAdminUrl(shop.domain, "/settings/checkout") : "#"}
                            external
                            size="slim"
                          >
                            {t("migrate.steps.modules.openSettings")}
                          </Button>
                        </BlockStack>
                      </Banner>
                    )}
                    {isModulesStep && canAccess && !stepStatus.completed && (
                      <>
                        <List type="number">
                          <List.Item>{t("migrate.steps.modules.list.0")}</List.Item>
                          <List.Item>{t("migrate.steps.modules.list.1")}</List.Item>
                          <List.Item>{t("migrate.steps.modules.list.2")}</List.Item>
                          <List.Item>{t("migrate.steps.modules.list.3")}</List.Item>
                        </List>
                        <InlineStack gap="200">
                          <Button
                            url={shop ? getShopifyAdminUrl(shop.domain, "/settings/checkout") : "#"}
                            external
                          >
                            {t("migrate.steps.modules.openSettings")}
                          </Button>
                          <Button
                            url={shop ? getShopifyAdminUrl(shop.domain, "/themes/current/editor") : "#"}
                            external
                          >
                            {t("migrate.steps.modules.themeEditor")}
                          </Button>
                        </InlineStack>
                        <img
                          src="/images/checkout-editor-step-1.svg"
                          alt="Checkout Editor"
                          style={{ maxWidth: "100%", height: "auto" }}
                        />
                        <Form method="post">
                          <input type="hidden" name="_action" value="markModulesStepDone" />
                          <Button submit variant="primary">
                            {t("migrate.steps.modules.markedDone")}
                          </Button>
                        </Form>
                      </>
                    )}
                    {(!isModulesStep || stepStatus.completed || !canAccess) && (
                      <InlineStack align="end">
                        {canAccess ? (
                          isModulesStep && stepStatus.completed ? (
                            <Button url="/app/verification" variant="secondary">
                              {t("migrate.steps.verification.next")}
                            </Button>
                          ) : !isModulesStep ? (
                            <Button
                              url={stepConfig.url}
                              variant={stepStatus.completed ? "secondary" : "primary"}
                              icon={stepStatus.completed ? undefined : ArrowRightIcon}
                            >
                              {stepStatus.completed ? t("migrate.buttons.viewDetails") : t("migrate.buttons.start")}
                            </Button>
                          ) : null
                        ) : (
                          <Button
                            url="/app/billing"
                            variant="secondary"
                            icon={LockIcon}
                          >
                            {t("migrate.buttons.upgrade")}
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
          <Banner tone="success" title={t("migrate.banner.completed.title")}>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                {t("migrate.banner.completed.desc")}
              </Text>
              <InlineStack gap="200">
                <Button url="/app/verification" variant="primary">
                  {t("migrate.banner.completed.action")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("migrate.explanation.title")}
            </Text>
            <Divider />
            <List type="number">
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("migrate.explanation.audit.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("migrate.explanation.audit.desc")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("migrate.explanation.pixels.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("migrate.explanation.pixels.desc")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("migrate.explanation.modules.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("migrate.explanation.modules.desc")}
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    {t("migrate.explanation.verification.title")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("migrate.explanation.verification.desc")}
                  </Text>
                </BlockStack>
              </List.Item>
            </List>
          </BlockStack>
        </Card>

        <CheckoutCompletedBehaviorHint mode="info" collapsible={true} />
        <Banner tone="info" title={t("migrate.banner.important.title")}>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("migrate.banner.important.subtitle")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
               <Trans i18nKey="migrate.banner.important.desc" />
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.banner.important.plus")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("migrate.banner.important.nonPlus")}
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("migrate.banner.important.advice")}
            </Text>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Page>
  );
}
