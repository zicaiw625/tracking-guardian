import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AppProvider, Card, Page, Text, Banner, BlockStack, } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisTranslationsEn from "@shopify/polaris/locales/en.json" assert { type: "json" };
import { login } from "../../shopify.server";
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
            polarisTranslations: polarisTranslationsEn,
        });
    }
    return json({
        hasShopParam: false,
        errors: null,
        polarisTranslations: polarisTranslationsEn,
    });
};
export default function Auth() {
    const { polarisTranslations, hasShopParam, errors } = useLoaderData<typeof loader>();
    return (<AppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h1">
              Tracking Guardian
            </Text>

            {hasShopParam && errors ? (<Banner tone="critical">
                <p>认证过程中发生错误，请重试或联系支持。</p>
              </Banner>) : (<>
                <Banner tone="info">
                  <p>请通过 Shopify 管理后台访问此应用</p>
                </Banner>

                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd">
                    <strong>如果您已安装此应用：</strong>
                  </Text>
                  <Text as="p" tone="subdued">
                    打开 Shopify 管理后台 → 设置 → 应用和销售渠道 → Tracking Guardian
                  </Text>

                  <Text as="p" variant="bodyMd">
                    <strong>如果您尚未安装：</strong>
                  </Text>
                  <Text as="p" tone="subdued">
                    请从 Shopify App Store 搜索并安装「Tracking Guardian」
                  </Text>
                </BlockStack>

                <Text as="p" tone="subdued" variant="bodySm">
                  根据 Shopify 平台要求，应用必须从 Shopify 管理后台或 App Store 启动，
                  不支持直接访问此页面进行登录。
                </Text>
              </>)}
          </BlockStack>
        </Card>
      </Page>
    </AppProvider>);
}
