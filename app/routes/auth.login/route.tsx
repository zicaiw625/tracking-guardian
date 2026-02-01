import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AppProvider, Card, Page, Text, Banner, BlockStack, InlineStack } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisTranslationsEn from "@shopify/polaris/locales/en.json" with { type: "json" };
import { login } from "../../shopify.server";
import { getPolarisTranslations } from "../../utils/polaris-i18n";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";

const i18nEn = getPolarisTranslations(polarisTranslationsEn);

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    if (shop) {
        const loginResponse = await login(request);
        if (loginResponse instanceof Response) {
            return loginResponse;
        }
        return json({
            hasShopParam: true,
            errors: loginResponse,
            polarisTranslations: i18nEn,
        });
    }
    return json({
        hasShopParam: false,
        errors: null,
        polarisTranslations: i18nEn,
    });
};

function AuthContent() {
    const { t } = useTranslation();
    const { polarisTranslations, hasShopParam, errors } = useLoaderData<typeof loader>();
    
    return (<AppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingLg" as="h1">
                Tracking Guardian
              </Text>
              <LanguageSwitcher />
            </InlineStack>
            {hasShopParam && errors ? (<Banner tone="critical">
                <p>{t("Auth.Login.Error")}</p>
              </Banner>) : (<>
                <Banner tone="info">
                  <p>{t("Auth.Login.Info")}</p>
                </Banner>
                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd">
                    <strong>{t("Auth.Login.InstalledTitle")}</strong>
                  </Text>
                  <Text as="p" tone="subdued">
                    {t("Auth.Login.InstalledDesc")}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>{t("Auth.Login.NotInstalledTitle")}</strong>
                  </Text>
                  <Text as="p" tone="subdued">
                    {t("Auth.Login.NotInstalledDesc")}
                  </Text>
                </BlockStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("Auth.Login.Footer")}
                </Text>
              </>)}
          </BlockStack>
        </Card>
      </Page>
    </AppProvider>);
}

export default function Auth() {
  return <AuthContent />;
}
