import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Card,
  Page,
  Text,
  Banner,
  BlockStack,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

/**
 * P0-1 COMPLETE FIX: Shopify App Store Requirement 2.3.1
 * 
 * "Installation and configuration must be initiated from Shopify-owned surfaces"
 * "Don't require shop domain input during install or configuration"
 * 
 * This page now:
 * 1. If shop param exists → initiate OAuth flow (handled by login())
 * 2. If no shop param → show static guidance page (NO form, NO input)
 * 
 * Manual shop input is COMPLETELY REMOVED to satisfy App Store requirements.
 * Developers can use Shopify CLI for local testing instead.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  
  // If shop param is provided (from Shopify Admin), initiate OAuth
  if (shop) {
    // login() will handle OAuth initiation or return errors
    const loginResponse = await login(request);
    
    // If login() returns a redirect, follow it
    if (loginResponse instanceof Response) {
      return loginResponse;
    }
    
    // If there are errors, the login function returns them
    // This shouldn't normally happen when shop param is valid
    return json({
      hasShopParam: true,
      errors: loginResponse,
      polarisTranslations: require("@shopify/polaris/locales/en.json"),
    });
  }
  
  // No shop param → show guidance page
  // P0-1: NO form, NO input field - just static guidance
  return json({
    hasShopParam: false,
    errors: null,
    polarisTranslations: require("@shopify/polaris/locales/en.json"),
  });
};

// P0-1: NO action handler - we don't accept form submissions
// All authentication must be initiated via Shopify-owned surfaces

export default function Auth() {
  const { polarisTranslations, hasShopParam, errors } = useLoaderData<typeof loader>();

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h1">
              Tracking Guardian
            </Text>
            
            {hasShopParam && errors ? (
              // Error state - shop param was provided but something went wrong
              <Banner tone="critical">
                <p>认证过程中发生错误，请重试或联系支持。</p>
              </Banner>
            ) : (
              // Normal state - no shop param, show guidance
              <>
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
                    请从 Shopify App Store 搜索并安装 "Tracking Guardian"
                  </Text>
                </BlockStack>
                
                <Text as="p" tone="subdued" variant="bodySm">
                  根据 Shopify 平台要求，应用必须从 Shopify 管理后台或 App Store 启动，
                  不支持直接访问此页面进行登录。
                </Text>
              </>
            )}
          </BlockStack>
        </Card>
      </Page>
    </AppProvider>
  );
}
