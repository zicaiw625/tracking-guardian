import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError, isRouteErrorResponse, useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import noncedAppStyles from "./styles/nonced-app.css?url";
import { suppressMonorailErrors } from "./utils/suppress-monorail-errors.client";
import { useTranslation } from "react-i18next";
import { useChangeLanguage } from "remix-i18next/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { i18nServer } from "./i18n.server";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: noncedAppStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const locale = await i18nServer.getLocale(request);
  return json({ locale });
}

function PerformanceMonitor() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      suppressMonorailErrors();
    }
  }, []);
  return null;
}

export default function App() {
  const { locale } = useLoaderData<typeof loader>();
  useChangeLanguage(locale);
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <Meta />
        <Links />
      </head>
      <body>
        <PerformanceMonitor />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>);
}

export function ErrorBoundary() {
  const error = useRouteError();
  const { t, i18n } = useTranslation();
  let title = t("errorPage.unknownTitle");
  let message = t("errorPage.unknownMessage");
  let code = "UNKNOWN_ERROR";
  let status = 500;
  const isProduction = process.env.NODE_ENV === "production";
  if (isRouteErrorResponse(error)) {
    status = error.status;
    title = error.status === 404
      ? t("errorPage.pageNotFound")
      : `${error.status} ${error.statusText || t("common.error")}`;
    message = typeof error.data === 'string'
      ? error.data
      : error.status === 404
        ? t("errorPage.pageNotFoundMessage")
        : t("errorPage.loadingError");
    code = `HTTP_${error.status}`;
  } else if (error instanceof Error) {
    message = error.message || t("errorPage.defaultMessage");
    code = error.name || t("common.error");
    console.error("[Root ErrorBoundary] Caught error:", error);
    if (error.stack) {
      import("./utils/debug-log.client").then(({ debugError }) => {
        debugError("Error stack:", error.stack);
      });
    }
  } else if (typeof error === "object" && error !== null) {
    console.error("[Root ErrorBoundary] Caught non-standard error:", error);
    const errObj = error as Record<string, unknown>;
    message = typeof errObj.message === "string"
      ? errObj.message
      : typeof errObj.error === "string"
        ? errObj.error
        : t("errorPage.unknownError");
    code = typeof errObj.code === "string"
      ? errObj.code
      : typeof errObj.name === "string"
        ? errObj.name
        : "UNKNOWN";
    import("./utils/debug-log.client").then(({ debugError }) => {
      debugError("Non-standard error caught in root ErrorBoundary:", error);
    });
  } else {
    message = t("errorPage.unknownError");
    code = "UNKNOWN";
    import("./utils/debug-log.client").then(({ debugError }) => {
      debugError("Unknown error type caught in root ErrorBoundary:", error);
    });
  }
  if (isProduction && status >= 500) {
    message = t("errorPage.unknownMessage");
    code = `ERROR_${status}`;
  }
  return (
    <html lang={i18n.language || "en"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="tg-error-body">
        <div className="tg-error-container">
          <div className="tg-error-card">
            <h1 className="tg-error-title">{title}</h1>
            <p className="tg-error-message">{message}</p>
            <p className="tg-error-code">{t("errorPage.errorCode")} {code}</p>
            <button
              className="tg-error-button"
              onClick={() => window.location.reload()}
            >
              {t("errorPage.retry")}
            </button>
          </div>
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
