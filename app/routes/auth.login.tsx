import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Card, Page, Text, Banner, BlockStack, Layout } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { login } from "../shopify.server";
import { useTranslation } from "react-i18next";
import { PublicLayout } from "~/components/layout/PublicLayout";

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
        });
    }
    return json({
        hasShopParam: false,
        errors: null,
    });
};

function AuthContent() {
    const { t } = useTranslation();
    const { hasShopParam, errors } = useLoaderData<typeof loader>();

    return (
    <PublicLayout showFooter={true}>
      <Page>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingLg" as="h1">
                  Tracking Guardian
                </Text>
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
          </Layout.Section>
        </Layout>
      </Page>
    </PublicLayout>);
}

export default function Auth() {
  return <AuthContent />;
}
