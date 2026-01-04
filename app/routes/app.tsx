import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import translations from "@shopify/polaris/locales/en.json" with { type: "json" };
import { authenticate } from "../shopify.server";
import { ToastProvider } from "../components/ui/ToastProvider";
import { getPolarisTranslations } from "../utils/polaris-i18n";

const i18n = getPolarisTranslations(translations);

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
    });
};
export default function App() {
    const { apiKey } = useLoaderData<typeof loader>();
    return (<AppProvider isEmbeddedApp apiKey={apiKey} i18n={i18n}>
      <NavMenu>
        <a href="/app" rel="home">升级迁移交付平台</a>
        <a href="/app/scan">体检&清单（免费 Audit）</a>
        <a href="/app/migrate">像素迁移</a>
        <a href="/app/ui-blocks">页面模块（Survey/Helpdesk）</a>
        <a href="/app/verification">验收+监控</a>
        <a href="/app/monitor">监控告警</a>
        <a href="/app/settings">设置</a>
        <a href="/app/billing">套餐管理</a>
      </NavMenu>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </AppProvider>);
}
export const headers: HeadersFunction = (headersArgs) => {
    return boundary.headers(headersArgs);
};
export function ErrorBoundary() {
    return (
        <PolarisAppProvider i18n={i18n}>
            {boundary.error(useRouteError())}
        </PolarisAppProvider>
    );
}
