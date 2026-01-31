import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AppProvider, Card, Page, Text, Banner, BlockStack, } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisTranslationsEn from "@shopify/polaris/locales/en.json" with { type: "json" };
import polarisTranslationsZh from "@shopify/polaris/locales/zh-CN.json" with { type: "json" };
import { login } from "../../shopify.server";
import { getLocaleFromRequest } from "../../utils/locale.server";
import { getPolarisTranslations } from "../../utils/polaris-i18n";

const i18nEn = getPolarisTranslations(polarisTranslationsEn);
const i18nZh = getPolarisTranslations(polarisTranslationsZh);

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const locale = getLocaleFromRequest(request);
    const polarisTranslations = locale === "zh" ? i18nZh : i18nEn;
    if (shop) {
        const loginResponse = await login(request);
        if (loginResponse instanceof Response) {
            return loginResponse;
        }
        return json({
            hasShopParam: true,
            errors: loginResponse,
            polarisTranslations,
            locale,
        });
    }
    return json({
        hasShopParam: false,
        errors: null,
        polarisTranslations,
        locale,
    });
};
export default function Auth() {
    const { polarisTranslations, hasShopParam, errors, locale } = useLoaderData<typeof loader>();
    const isZh = locale === "zh";
    return (<AppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h1">
              Tracking Guardian
            </Text>
            {hasShopParam && errors ? (<Banner tone="critical">
                <p>{isZh ? "认证过程中发生错误，请重试或联系支持。" : "An error occurred during authentication. Please try again or contact support."}</p>
              </Banner>) : (<>
                <Banner tone="info">
                  <p>{isZh ? "请通过 Shopify 管理后台访问此应用" : "Please access this app from the Shopify admin."}</p>
                </Banner>
                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd">
                    <strong>{isZh ? "如果您已安装此应用：" : "If you have already installed this app:"}</strong>
                  </Text>
                  <Text as="p" tone="subdued">
                    {isZh ? "打开 Shopify 管理后台 → 设置 → 应用和销售渠道 → Tracking Guardian" : "Open Shopify admin → Settings → Apps and sales channels → Tracking Guardian"}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>{isZh ? "如果您尚未安装：" : "If you have not installed yet:"}</strong>
                  </Text>
                  <Text as="p" tone="subdued">
                    {isZh ? "请从 Shopify App Store 搜索并安装「Tracking Guardian」" : "Search for and install Tracking Guardian from the Shopify App Store."}
                  </Text>
                </BlockStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  {isZh ? "根据 Shopify 平台要求，应用必须从 Shopify 管理后台或 App Store 启动，不支持直接访问此页面进行登录。" : "Per Shopify requirements, the app must be launched from the Shopify admin or App Store; direct access to this page for login is not supported."}
                </Text>
              </>)}
          </BlockStack>
        </Card>
      </Page>
    </AppProvider>);
}
