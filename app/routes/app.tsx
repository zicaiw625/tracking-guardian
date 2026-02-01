import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisTranslationsEn from "@shopify/polaris/locales/en.json" with { type: "json" };
import polarisTranslationsZh from "@shopify/polaris/locales/zh-CN.json" with { type: "json" };
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ToastProvider } from "../components/ui/ToastProvider";
import { getPolarisTranslations } from "../utils/polaris-i18n";
import { TopBar } from "../components/layout/TopBar";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { useTranslation } from "react-i18next";

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
    
    return json({
        apiKey: process.env.SHOPIFY_API_KEY || "",
        shopDomain,
        planId: planIdNormalized,
        currentShopId: shop?.id,
    });
};
export default function App() {
    const { apiKey, shopDomain, planId, currentShopId } = useLoaderData<typeof loader>();
    const { t, i18n } = useTranslation();
    
    const polarisTranslations = i18n.language?.startsWith("zh") ? polarisTranslationsZh : polarisTranslationsEn;
    const polarisI18n = getPolarisTranslations(polarisTranslations);

    return (<AppProvider isEmbeddedApp apiKey={apiKey} i18n={polarisI18n as any} key={i18n.language}>
      <NavMenu>
        <a href="/app" rel="home">{t("nav.dashboard")}</a>
        <a href="/app/scan">{t("nav.audit")}</a>
        <a href="/app/pixels">{t("nav.pixels")}</a>
        <a href="/app/verification">{t("nav.verification")}</a>
        <a href="/app/monitoring">{t("nav.monitoring")}</a>
        <a href="/app/settings">{t("nav.settings")}</a>
        <a href="/app/billing">{t("nav.billing")}</a>
      </NavMenu>
      <TopBar
        shopDomain={shopDomain}
        planId={planId}
        planDisplayName={t(`plans.${planId}`)}
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
    const { i18n } = useTranslation();
    const polarisTranslations = i18n.language?.startsWith("zh") ? polarisTranslationsZh : polarisTranslationsEn;
    const polarisI18n = getPolarisTranslations(polarisTranslations);

    return (
        <PolarisAppProvider i18n={polarisI18n as any}>
            {boundary.error(useRouteError())}
        </PolarisAppProvider>
    );
}
