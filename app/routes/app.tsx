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
import { getShopPlan, refreshShopTierWithAdmin } from "../services/shop-tier.server";
import { TopBar } from "../components/layout/TopBar";
import { normalizePlanId, type PlanId } from "../services/billing/plans";

const i18n = getPolarisTranslations(translations);

const SHOP_TIER_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            plan: true,
            shopTier: true,
            updatedAt: true,
        },
    });
    
    // Refresh shop tier if needed (with 24h cache)
    if (shop && admin) {
        const shouldRefresh = !shop.shopTier || 
            !shop.updatedAt || 
            (Date.now() - shop.updatedAt.getTime()) > SHOP_TIER_CACHE_TTL_MS;
        
        if (shouldRefresh) {
            try {
                await refreshShopTierWithAdmin(admin, shop.id);
            } catch (error) {
                // Log error but don't block page load
                console.error("Failed to refresh shop tier:", error);
            }
        }
    }
    
    const planInfo = admin ? await getShopPlan(admin) : null;
    const planIdNormalized = normalizePlanId(shop?.plan || "free") as PlanId;
    return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        planDisplayName: planInfo?.displayName ?? "Unknown",
        shopDomain,
        planId: planIdNormalized,
        currentShopId: shop?.id,
    });
};
export default function App() {
    const { apiKey, shopDomain, planId, planDisplayName, currentShopId } = useLoaderData<typeof loader>();
    return (<AppProvider isEmbeddedApp apiKey={apiKey} i18n={i18n as any}>
      <NavMenu>
        <a href="/app" rel="home">Dashboard</a>
        <a href="/app/audit/scan">Audit</a>
        <a href="/app/migrate">Migrate</a>
        <a href="/app/modules">Modules</a>
        <a href="/app/pixels">Pixels</a>
        <a href="/app/diagnostics">Diagnostics</a>
        <a href="/app/verification">Verification</a>
        <a href="/app/monitor">Monitor</a>
        <a href="/app/settings">Settings</a>
        <a href="/app/billing">Billing</a>
        <a href="/app/privacy">Privacy</a>
      </NavMenu>
      <TopBar
        shopDomain={shopDomain}
        planId={planId}
        planDisplayName={planDisplayName}
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
