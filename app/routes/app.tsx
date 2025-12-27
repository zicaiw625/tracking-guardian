import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import translations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
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
        <Link to="/app" rel="home">
          首页
        </Link>
        <Link to="/app/scan">扫描报告</Link>
        <Link to="/app/migrate">迁移工具</Link>
        <Link to="/app/verification">验收向导</Link>
        <Link to="/app/monitor">监控面板</Link>
        <Link to="/app/reconciliation">送达健康度</Link>
        <Link to="/app/privacy">隐私与数据</Link>
        <Link to="/app/settings">设置</Link>
      </NavMenu>
      <Outlet />
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
