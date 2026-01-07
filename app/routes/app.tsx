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
import prisma from "../db.server";
import { ToastProvider } from "../components/ui/ToastProvider";
import { getPolarisTranslations } from "../utils/polaris-i18n";
import { getShopPlan } from "../services/shop-tier.server";
import { isPlanAtLeast, normalizePlan } from "../utils/plans";

const i18n = getPolarisTranslations(translations);

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            plan: true,
        },
    });
    const planInfo = admin ? await getShopPlan(admin) : null;
    const planId = normalizePlan(shop?.plan);
    const workspaceShop = shop
        ? await prisma.workspaceShop.findFirst({
            where: { shopId: shop.id },
            select: { id: true },
        })
        : null;
    const isAgency = isPlanAtLeast(planId, "agency") || !!workspaceShop || planInfo?.partnerDevelopment === true;
    return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        isAgency,
        planDisplayName: planInfo?.displayName ?? "Unknown",
    });
};
export default function App() {
    const { apiKey, isAgency } = useLoaderData<typeof loader>();

    return (<AppProvider isEmbeddedApp apiKey={apiKey} i18n={i18n as any}>
      <NavMenu>
        {isAgency ? (
          <>
            <a href="/app/workspace">Workspaces</a>
            <a href="/app/workspace?tab=shops">Shops</a>
            <a href="/app/workspace/templates">Templates</a>
            <a href="/app/reports?scope=agency">Reports</a>
            <a href="/app/workspace?tab=team">Team &amp; Roles</a>
          </>
        ) : (
          <>
            <a href="/app" rel="home">Dashboard</a>
            <a href="/app/scan">Audit</a>
            <a href="/app/pixels">Pixels</a>
            <a href="/app/ui-blocks">Modules</a>
            <a href="/app/verification">Verification</a>
            <a href="/app/monitor">Monitoring</a>
            <a href="/app/alerts">Alerts/告警中心</a>
            <a href="/app/reports">Reports</a>
            <a href="/app/billing">Billing</a>
            <a href="/app/settings">Settings</a>
            <a href="/app/support">Support</a>
          </>
        )}
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
        <PolarisAppProvider i18n={i18n as any}>
            {boundary.error(useRouteError())}
        </PolarisAppProvider>
    );
}
