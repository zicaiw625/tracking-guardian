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
export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
    });
};
export default function App() {
    const { apiKey } = useLoaderData<typeof loader>();
    return (<AppProvider isEmbeddedApp apiKey={apiKey} i18n={translations}>
      <NavMenu>
        <a href="/app" rel="home">首页</a>
        <a href="/app/scan">扫描报告</a>
        <a href="/app/migrate">迁移工具</a>
        <a href="/app/ui-blocks">UI 模块</a>
        <a href="/app/verification">验收向导</a>
        <a href="/app/monitor">监控面板</a>
        <a href="/app/reconciliation">送达健康度</a>
        <a href="/app/workspace">多店管理</a>
        <a href="/app/privacy">隐私与数据</a>
        <a href="/app/settings">设置</a>
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
        <PolarisAppProvider i18n={translations}>
            {boundary.error(useRouteError())}
        </PolarisAppProvider>
    );
}
