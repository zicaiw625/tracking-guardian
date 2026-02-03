import type { loader } from "./app.pixels.new/loader.server";
import type { action } from "./app.pixels.new/action.server";
export { loader } from "./app.pixels.new/loader.server";
export { action } from "./app.pixels.new/action.server";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  useNavigate,
} from "@remix-run/react";
import { useEffect } from "react";
import { Page, BlockStack, Text, Banner, List } from "@shopify/polaris";
import { useToastContext } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { NewPixelWizard } from "~/components/pixels/NewPixelWizard";
import { useTranslation, Trans } from "react-i18next";

export default function PixelsNewPage() {
  const { t } = useTranslation();
  const loaderData = useLoaderData<typeof loader>();
  const { shop, templates, isStarterOrAbove, backendUrlInfo } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToastContext();

  useEffect(() => {
    if (backendUrlInfo?.placeholderDetected) {
      showError(t("pixels.new.errors.placeholder"));
    }
  }, [backendUrlInfo?.placeholderDetected, showError, t]);

  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      const configIds = ("configIds" in actionData ? actionData.configIds : []) || [];
      showSuccess(t("pixels.new.success"));
      if (configIds.length === 1) {
        navigate(`/app/pixels/${configIds[0]}/test`);
      } else {
        navigate("/app/pixels");
      }
    } else if (actionData && "error" in actionData && actionData.error) {
      showError(actionData.error);
    }
  }, [actionData, navigate, showSuccess, showError, t]);

  if (!shop) {
    return (
      <Page title={t("pixels.new.title")}>
        <Banner tone="critical" title={t("pixels.new.shopNotFound")}>
          <Text as="p">{t("pixels.new.shopNotFoundDesc")}</Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title={t("pixels.new.title")}
      subtitle={t("pixels.new.subtitle")}
      backAction={{ content: t("pixels.new.back"), url: "/app/pixels" }}
    >
      <BlockStack gap="500">
        {backendUrlInfo?.placeholderDetected && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.new.banners.placeholder.title")}
              </Text>
              <Text as="p" variant="bodySm">
                 <Trans i18nKey="pixels.new.banners.placeholder.desc" />
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.new.banners.placeholder.stepsTitle")}
              </Text>
              <List type="number">
                {(t("pixels.new.banners.placeholder.steps", { returnObjects: true }) as string[]).map((step, i) => (
                  <List.Item key={i}>
                    <Text as="span" variant="bodySm">
                       <Trans defaults={step} components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" />, code: <code /> }} />
                    </Text>
                  </List.Item>
                ))}
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("pixels.new.banners.placeholder.tip")}
              </Text>
            </BlockStack>
          </Banner>
        )}
        {!backendUrlInfo?.placeholderDetected && backendUrlInfo?.isConfigured && (
          <Banner tone="info">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.new.banners.configured.title")}
              </Text>
              <Text as="p" variant="bodySm">
                 <Trans i18nKey="pixels.new.banners.configured.desc" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.new.banners.configured.important")}
              </Text>
              <Text as="p" variant="bodySm">
                 <Trans i18nKey="pixels.new.banners.configured.importantDesc" components={{ strong: <strong />, a: <a target="_blank" rel="noopener noreferrer" /> }} />
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="warning">
          <BlockStack gap="300">
            <Text as="p" variant="headingSm" fontWeight="bold">
              {t("pixels.new.banners.sandbox.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("pixels.new.banners.sandbox.desc")}
            </Text>
            <List type="bullet">
              {(t("pixels.new.banners.sandbox.limitations", { returnObjects: true }) as string[]).map((item, i) => (
                 <List.Item key={i}>
                    <Text as="span" variant="bodySm">{item}</Text>
                 </List.Item>
              ))}
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    <strong>{t("pixels.new.banners.sandbox.unsupported.title")}</strong>
                  </Text>
                  <Text as="span" variant="bodySm">
                    {t("pixels.new.banners.sandbox.unsupported.desc")}
                  </Text>
                  <List type="bullet">
                    {(t("pixels.new.banners.sandbox.unsupported.items", { returnObjects: true }) as string[]).map((item, i) => (
                      <List.Item key={i}>
                        <Text as="span" variant="bodySm" tone="subdued">{item}</Text>
                      </List.Item>
                    ))}
                  </List>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {t("pixels.new.banners.sandbox.unsupported.note")}
                  </Text>
                  <Text as="span" variant="bodySm">
                    {t("pixels.new.banners.sandbox.unsupported.review")}
                  </Text>
                </BlockStack>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("pixels.new.banners.sandbox.reviewPoints.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("pixels.new.banners.sandbox.reviewPoints.desc")}
            </Text>
            <List type="bullet">
               {(t("pixels.new.banners.sandbox.reviewPoints.items", { returnObjects: true }) as string[]).map((item, i) => (
                  <List.Item key={i}>
                    <Text as="span" variant="bodySm">{item}</Text>
                  </List.Item>
               ))}
            </List>
          </BlockStack>
        </Banner>
        <PageIntroCard
          title={t("pixels.new.intro.title")}
          description={t("pixels.new.intro.desc")}
          items={t("pixels.new.intro.items", { returnObjects: true }) as string[]}
          primaryAction={{ content: t("pixels.new.intro.action"), url: "/app/pixels" }}
        />
        {!isStarterOrAbove && (
          <Banner tone="warning" title={t("pixels.new.banners.upgrade.title")}>
            <Text as="p">
              {t("pixels.new.banners.upgrade.desc")}
            </Text>
          </Banner>
        )}
        <NewPixelWizard
          templates={templates ? { presets: templates.presets ?? [], custom: Array.isArray(templates.custom) ? templates.custom.filter((t): t is NonNullable<typeof t> => t != null) : [] } : null}
          isStarterOrAbove={isStarterOrAbove}
          backendUrlInfo={backendUrlInfo}
          submit={submit}
          isSubmitting={navigation.state === "submitting"}
          showSuccess={showSuccess}
          showError={showError}
        />
      </BlockStack>
    </Page>
  );
}
