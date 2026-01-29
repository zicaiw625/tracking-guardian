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
import { TopBar } from "../components/layout/TopBar";
import { normalizePlanId, type PlanId } from "../services/billing/plans";

const i18n = getPolarisTranslations(translations);

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
            id: true,
            plan: true,
            shopTier: true,
            shopTierLastCheckedAt: true,
        },
    });
    
    const planIdNormalized = normalizePlanId(shop?.plan || "free") as PlanId;
    const planDisplayNameMap: Record<string, string> = {
        free: "Free",
        starter: "Starter",
        pro: "Pro",
        enterprise: "Enterprise",
    };
    const planDisplayName = planDisplayNameMap[planIdNormalized] || "Unknown";
    
    return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        planDisplayName,
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
        <a href="/app/scan">Audit</a>
        <a href="/app/pixels">Pixels</a>
        <a href="/app/verification">Verification</a>
        <a href="/app/monitoring">Monitoring</a>
        <a href="/app/settings">Settings</a>
        <a href="/app/billing">Billing</a>
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
