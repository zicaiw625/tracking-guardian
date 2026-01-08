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
import { TopBar } from "../components/layout/TopBar";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { getAlertHistory } from "../services/alert-dispatcher.server";

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
    const planIdNormalized = normalizePlanId(shop?.plan || "free") as PlanId;
    const workspaceShop = shop
        ? await prisma.workspaceShop.findFirst({
            where: { shopId: shop.id },
            select: { workspaceId: true },
        })
        : null;
    const isAgency = isPlanAtLeast(planId, "agency") || !!workspaceShop || planInfo?.partnerDevelopment === true;

        let alertCount = 0;
    if (shop) {
        try {
            const alertHistory = await getAlertHistory(shop.id, 50);
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            alertCount = alertHistory.filter(
                (alert) => !alert.acknowledged && alert.createdAt >= twentyFourHoursAgo
            ).length;
        } catch (error) {
                    }
    }

        let activeShops: Array<{ id: string; domain: string }> | undefined;
    if (isAgency && shop && workspaceShop) {
        try {
            const workspaceShops = await prisma.workspaceShop.findMany({
                where: { workspaceId: workspaceShop.workspaceId },
                select: {
                    shopId: true,
                },
            });
            const shopIds = workspaceShops.map((ws) => ws.shopId);
            const shops = await prisma.shop.findMany({
                where: {
                    id: { in: shopIds },
                },
                select: {
                    id: true,
                    shopDomain: true,
                },
            });
            activeShops = shops.map((s) => ({
                id: s.id,
                domain: s.shopDomain,
            }));
        } catch (error) {
                    }
    }

    return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        isAgency,
        planDisplayName: planInfo?.displayName ?? "Unknown",
        shopDomain,
        planId: planIdNormalized,
        alertCount,
        activeShops,
        currentShopId: shop?.id,
    });
};
export default function App() {
    const { apiKey, isAgency, shopDomain, planId, planDisplayName, alertCount, activeShops, currentShopId } = useLoaderData<typeof loader>();

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
            <a href="/app/audit/start">Audit</a>
            <a href="/app/pixels">Pixels</a>
            <a href="/app/modules">Modules</a>
            <a href="/app/verification">Verification</a>
            <a href="/app/monitor">Monitoring</a>
            <a href="/app/reports">Reports</a>
            <a href="/app/billing">Billing</a>
            <a href="/app/settings">Settings</a>
            <a href="/app/support">Support</a>
          </>
        )}
      </NavMenu>
      <TopBar
        shopDomain={shopDomain}
        planId={planId}
        planDisplayName={planDisplayName}
        isAgency={isAgency}
        alertCount={alertCount}
        activeShops={activeShops}
        currentShopId={currentShopId}
      />
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
