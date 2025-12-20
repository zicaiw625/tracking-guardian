import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
  Banner,
  BlockStack,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useState } from "react";

import { login } from "../../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

/**
 * P0-1 FIX: Shopify App Store Requirement 2.3.1
 * 
 * "Installation and configuration must be initiated from Shopify-owned surfaces"
 * "Don't require shop domain input during install or configuration"
 * 
 * Solution:
 * - In PRODUCTION: Show a message directing users to Shopify Admin/App Store
 * - In DEVELOPMENT: Allow manual shop input for local testing only
 */
function isDevMode(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = login(request);

  return json({
    errors,
    polarisTranslations: require("@shopify/polaris/locales/en.json"),
    allowManualLogin: isDevMode(),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // P0-1: In production, reject manual login attempts
  if (!isDevMode()) {
    return json({ 
      errors: { 
        shop: "Please install this app from the Shopify App Store or your Shopify Admin." 
      } 
    });
  }
  
  const errors = await login(request);

  return json({ errors });
};

export default function Auth() {
  const { polarisTranslations, allowManualLogin } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const errors = actionData?.errors || {};

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          {allowManualLogin ? (
            // Development mode: Allow manual shop input for local testing
            <Form method="post">
              <FormLayout>
                <Banner tone="warning">
                  <p>开发模式：此登录方式仅供本地测试使用</p>
                </Banner>
                <Text variant="headingMd" as="h2">
                  开发环境登录
                </Text>
                <TextField
                  type="text"
                  name="shop"
                  label="店铺域名"
                  helpText="示例: my-shop-domain.myshopify.com"
                  value={shop}
                  onChange={setShop}
                  autoComplete="on"
                  error={errors.shop}
                />
                <Button submit>登录</Button>
              </FormLayout>
            </Form>
          ) : (
            // Production mode: Direct users to proper installation flow
            // P0-1 FIX: No manual shop input allowed per Shopify requirement 2.3.1
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Tracking Guardian
              </Text>
              <Banner tone="info">
                <p>请通过以下方式安装或访问此应用：</p>
              </Banner>
              <Text as="p">
                <strong>方式一：</strong>从 Shopify App Store 安装此应用
              </Text>
              <Text as="p">
                <strong>方式二：</strong>打开您的 Shopify 管理后台 → 应用 → Tracking Guardian
              </Text>
              <Text as="p" tone="subdued">
                如果您已安装此应用，请从 Shopify 管理后台打开它。
                如果尚未安装，请从 Shopify App Store 搜索并安装 "Tracking Guardian"。
              </Text>
            </BlockStack>
          )}
        </Card>
      </Page>
    </AppProvider>
  );
}

